"""Server-side cart business logic.

Ownership: the user-facing cart is the **only** source of truth — the
Zustand guest cart on the frontend merges into this one at login time.

Key business rules (enforced here, not in the router):

1. **Single-restaurant cart**. Adding an item from a restaurant different
   from the rows already in the cart *replaces* the cart atomically
   (delete-all + insert). The service signals this to the router via a
   boolean return; the router then emits the ``X-Cart-Replaced: true``
   response header so the frontend can show a toast.

2. **Options-based dedup**. ``options_hash`` is an md5 of
   ``menu_item_id || json.dumps(options, sort_keys=True)``. If a matching
   ``(user_id, menu_item_id, options_hash)`` row already exists, we
   increment ``qty`` instead of inserting a duplicate. The DB also
   enforces this via the unique constraint in
   :class:`~zerozero_api.domain.cart.CartItem.__table_args__`.

3. **Price at runtime**. ``line_total`` is computed from the current
   ``menu_items.price``. A true snapshot is taken later at checkout
   (Agent 2, Orders) — before that moment the customer can still see
   price updates reflected live.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from zerozero_api.core.errors import NotFoundError, ValidationError_
from zerozero_api.domain.cart import CartItem
from zerozero_api.domain.menu import MenuItem
from zerozero_api.domain.restaurant import Restaurant
from zerozero_api.schemas.cart import (
    CartItemIn,
    CartItemOut,
    CartOut,
    MenuItemBrief,
)

__all__ = [
    "add_item",
    "clear_cart",
    "get_cart",
    "remove_item",
    "update_item",
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _compute_options_hash(menu_item_id: UUID, options: dict | None) -> str:
    """Return a stable md5 hex digest for dedup.

    The hash space is ``menu_item_id || canonical-json(options)``. Using
    ``sort_keys=True`` + ``separators=(",", ":")`` makes the encoding
    deterministic across Python versions. An empty / None ``options``
    canonicalises to ``{}`` so "no options" rows also dedup.
    """
    canonical_options = json.dumps(
        options or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    raw = f"{menu_item_id}|{canonical_options}".encode("utf-8")
    return hashlib.md5(raw).hexdigest()


def _normalize_options(options: dict | None) -> dict:
    """Coerce the ``options`` payload into the JSONB-friendly shape.

    The column is ``JSONB NOT NULL DEFAULT '{}'::jsonb`` so we persist
    ``{}`` rather than NULL for "no options". Returning ``None`` from
    the wire is convenience sugar that maps to ``{}`` here.
    """
    return options or {}


def _options_for_output(stored: dict | None) -> dict | None:
    """Inverse of :func:`_normalize_options` — pretty for the wire."""
    if not stored:
        return None
    return stored


def _line_total(item: MenuItem, qty: int) -> Decimal:
    """``price * qty`` with two-decimal precision."""
    return (item.price * Decimal(qty)).quantize(Decimal("0.01"))


def _to_out(row: CartItem) -> CartItemOut:
    """Build a :class:`CartItemOut` from a loaded cart row."""
    brief = MenuItemBrief(
        id=row.menu_item.id,
        name=row.menu_item.name,
        price=row.menu_item.price,
        image_url=row.menu_item.image_url,
        is_veg=row.menu_item.is_veg,
        is_available=row.menu_item.is_available,
    )
    return CartItemOut(
        id=row.id,
        restaurant_id=row.restaurant_id,
        menu_item_id=row.menu_item_id,
        qty=row.qty,
        options=_options_for_output(row.options),
        item=brief,
        line_total=_line_total(row.menu_item, row.qty),
    )


async def _fetch_rows(
    db: AsyncSession, user_id: UUID
) -> list[CartItem]:
    """Load the caller's cart rows with menu-item + restaurant eagerly joined.

    Ordered by ``created_at`` so UI insertion order is stable across
    reads.
    """
    stmt = (
        select(CartItem)
        .where(CartItem.user_id == user_id)
        .options(
            selectinload(CartItem.menu_item),
            selectinload(CartItem.restaurant),
        )
        .order_by(CartItem.created_at.asc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _fetch_single_row(
    db: AsyncSession, *, user_id: UUID, item_id: UUID
) -> CartItem:
    """Load one cart row scoped by caller. Raises 404 when missing."""
    stmt = (
        select(CartItem)
        .where(CartItem.user_id == user_id, CartItem.id == item_id)
        .options(
            selectinload(CartItem.menu_item),
            selectinload(CartItem.restaurant),
        )
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None:
        raise NotFoundError("cart_item_not_found", code="not_found")
    return row


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_cart(db: AsyncSession, user_id: UUID) -> CartOut:
    """Return the caller's full cart grouped by its single restaurant.

    Empty cart ⇒ ``restaurant_id=None``, ``items=[]``, ``subtotal=0``.
    """
    rows = await _fetch_rows(db, user_id)
    items = [_to_out(r) for r in rows]

    restaurant_id: UUID | None = None
    restaurant_name: str | None = None
    if rows:
        first = rows[0]
        restaurant_id = first.restaurant_id
        restaurant_name = first.restaurant.name

    subtotal = sum((i.line_total for i in items), Decimal("0.00"))
    item_count = sum(i.qty for i in items)

    return CartOut(
        restaurant_id=restaurant_id,
        restaurant_name=restaurant_name,
        items=items,
        subtotal=subtotal.quantize(Decimal("0.01")),
        item_count=item_count,
    )


async def add_item(
    db: AsyncSession,
    user_id: UUID,
    data: CartItemIn,
) -> tuple[CartItemOut, bool]:
    """Add an item to the cart, enforcing the single-restaurant rule.

    Returns ``(row, was_cart_replaced)`` — the router uses the flag to
    emit ``X-Cart-Replaced: true`` so the frontend can toast.

    Failure modes:
      - Menu item doesn't exist → 404
      - Menu item's restaurant is inactive / missing → 404
      - Menu item is unavailable → 422
    """
    # Load the menu item with its restaurant eagerly.
    stmt = (
        select(MenuItem)
        .where(MenuItem.id == data.menu_item_id)
        .options(selectinload(MenuItem.restaurant))
    )
    result = await db.execute(stmt)
    menu_item = result.scalar_one_or_none()
    if menu_item is None:
        raise NotFoundError("menu_item_not_found", code="not_found")
    if not menu_item.is_available:
        raise ValidationError_(
            "menu_item_unavailable", code="validation_error"
        )

    restaurant: Restaurant | None = menu_item.restaurant
    if restaurant is None:
        raise NotFoundError("restaurant_not_found", code="not_found")

    # If the caller already has a cart from a *different* restaurant,
    # wipe it. This is the business rule confirmed via X-Cart-Replaced.
    was_replaced = False
    existing_rows = await _fetch_rows(db, user_id)
    if existing_rows:
        current_restaurant_id = existing_rows[0].restaurant_id
        if current_restaurant_id != restaurant.id:
            await db.execute(
                delete(CartItem).where(CartItem.user_id == user_id)
            )
            # Drop stale references so the dedup lookup below doesn't
            # hit rows that are pending deletion in this session.
            await db.flush()
            was_replaced = True

    options = _normalize_options(data.options)
    options_hash = _compute_options_hash(data.menu_item_id, options)

    # Dedup: if a matching row exists, just bump qty.
    dedup_stmt = select(CartItem).where(
        CartItem.user_id == user_id,
        CartItem.menu_item_id == data.menu_item_id,
        CartItem.options_hash == options_hash,
    )
    dedup_result = await db.execute(dedup_stmt)
    existing = dedup_result.scalar_one_or_none()

    if existing is not None:
        new_qty = existing.qty + int(data.qty)
        # Cap at schema max so dedup can't smuggle past the per-line limit.
        if new_qty > 50:
            new_qty = 50
        existing.qty = new_qty
        db.add(existing)
        await db.flush()
        row = await _fetch_single_row(db, user_id=user_id, item_id=existing.id)
        return _to_out(row), was_replaced

    row = CartItem(
        user_id=user_id,
        restaurant_id=restaurant.id,
        menu_item_id=menu_item.id,
        qty=int(data.qty),
        options=options,
        options_hash=options_hash,
    )
    db.add(row)
    await db.flush()

    loaded = await _fetch_single_row(db, user_id=user_id, item_id=row.id)
    return _to_out(loaded), was_replaced


async def update_item(
    db: AsyncSession,
    user_id: UUID,
    item_id: UUID,
    qty: int,
) -> CartItemOut:
    """Patch the quantity of an existing cart row.

    Quantity bounds are already enforced by :class:`CartItemPatchIn`;
    we still clamp defensively here in case the service is called from
    non-HTTP callers (tests / merge-on-login hook).
    """
    if qty < 1 or qty > 50:
        raise ValidationError_(
            "qty_out_of_range", code="validation_error"
        )

    row = await _fetch_single_row(db, user_id=user_id, item_id=item_id)
    row.qty = int(qty)
    db.add(row)
    await db.flush()

    refreshed = await _fetch_single_row(db, user_id=user_id, item_id=item_id)
    return _to_out(refreshed)


async def remove_item(
    db: AsyncSession,
    user_id: UUID,
    item_id: UUID,
) -> None:
    """Delete a single cart row owned by the caller. 404 if not present."""
    row = await _fetch_single_row(db, user_id=user_id, item_id=item_id)
    await db.delete(row)
    await db.flush()


async def clear_cart(db: AsyncSession, user_id: UUID) -> None:
    """Delete every cart row owned by the caller.

    Idempotent: a clear on an already-empty cart is a no-op 204.
    """
    await db.execute(delete(CartItem).where(CartItem.user_id == user_id))
    await db.flush()

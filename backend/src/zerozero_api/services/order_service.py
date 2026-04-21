"""Order lifecycle service — checkout, list, detail, cancel, review, track.

The router layer is intentionally thin; this module carries the full
business rules from ``docs/PHASE3_CONTRACTS.md`` (Orders section):

  * :func:`checkout` — atomic cart-to-order materialization. Snapshots
    names+prices, computes delivery-fee/tax/discount, seeds the initial
    ``order_status_events`` row, and deletes the cart rows. One DB
    transaction; the ``get_db`` dependency commits on successful return.
  * :func:`list_orders` — paginated tile list per-user with an optional
    status filter (``?status=active`` / ``delivered`` / ``cancelled``).
  * :func:`get_order` — full detail projection (404 if not caller's).
  * :func:`cancel_order` — state-machine-gated cancel: only ``placed``
    or ``confirmed`` orders may cancel. Appends a status event.
  * :func:`create_review` — gate on ``status=delivered`` + one-per-order
    uniqueness; the row insert handles the rest.
  * :func:`get_track` — lightweight polling payload accepting either the
    logged-in UUID path or the public ``share_token`` for anonymous
    tracking links.

Design notes
------------
* Money is :class:`~decimal.Decimal` end-to-end. All rounding uses
  :data:`decimal.ROUND_HALF_UP` with 2 decimal places.
* PostGIS distance is computed inline via ``ST_Distance`` over the
  geography columns (``restaurants.location`` <-> ``addresses.location``).
  We cast geometries for compatibility with ``ST_X``/``ST_Y`` on the
  read side when building :class:`AddressOut`.
* Phase 3 skips rating aggregate recompute on review create by design —
  Phase 4 (or a cron) will handle it.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal
from uuid import UUID, uuid4

from geoalchemy2 import Geometry
from geoalchemy2.functions import ST_Distance, ST_X, ST_Y
from sqlalchemy import cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from zerozero_api.core.errors import (
    ConflictError,
    NotFoundError,
    ValidationError_,
)
from zerozero_api.domain.address import Address
from zerozero_api.domain.cart import CartItem
from zerozero_api.domain.enums import ActorType, OrderStatus, PaymentStatus
from zerozero_api.domain.menu import MenuItem
from zerozero_api.domain.order import Order, OrderItem, OrderStatusEvent
from zerozero_api.domain.restaurant import Restaurant
from zerozero_api.domain.review import Review
from zerozero_api.domain.user import User
from zerozero_api.schemas.address import AddressOut
from zerozero_api.schemas.common import PageOut
from zerozero_api.schemas.order import (
    CheckoutIn,
    OrderDetailOut,
    OrderItemOut,
    OrderListItem,
    OrderStatusEventOut,
    OrderTrackOut,
)
from zerozero_api.schemas.review import ReviewCreateIn
from zerozero_api.services import promo_service

__all__ = [
    "cancel_order",
    "checkout",
    "create_review",
    "get_order",
    "get_track",
    "list_orders",
]


# Decimal quantization for money (2dp, half-up).
_MONEY_Q = Decimal("0.01")
_ZERO = Decimal("0.00")
# Canonical state-machine guard for cancellation.
_CANCELLABLE_STATES: frozenset[OrderStatus] = frozenset(
    {OrderStatus.PLACED, OrderStatus.CONFIRMED}
)
# Status-filter aliases accepted by list_orders.
_ACTIVE_STATES: tuple[OrderStatus, ...] = (
    OrderStatus.PLACED,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
    OrderStatus.OUT_FOR_DELIVERY,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _money(value: Decimal | float | int) -> Decimal:
    """Quantize a numeric value to 2 decimal places, half-up."""
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(_MONEY_Q, rounding=ROUND_HALF_UP)


async def _load_address_for_user(
    db: AsyncSession, *, user_id: UUID, address_id: UUID
) -> tuple[Address, float, float]:
    """Load a user-owned address + decoded ``(lat, lng)``.

    Raises :class:`NotFoundError` if the address doesn't belong to the
    caller. Cast geography -> geometry so ``ST_X``/``ST_Y`` work across
    PostGIS versions.
    """
    geom = cast(Address.location, Geometry)
    stmt = (
        select(Address, ST_Y(geom).label("lat"), ST_X(geom).label("lng"))
        .where(Address.id == address_id, Address.user_id == user_id)
        .limit(1)
    )
    result = await db.execute(stmt)
    row = result.first()
    if row is None:
        raise NotFoundError("Address not found", code="address_not_found")
    addr, lat, lng = row
    return addr, float(lat or 0.0), float(lng or 0.0)


def _address_to_out(addr: Address, lat: float, lng: float) -> AddressOut:
    """Materialize :class:`AddressOut` for order-detail responses."""
    return AddressOut(
        id=addr.id,
        user_id=addr.user_id,
        label=addr.label,
        line1=addr.line1,
        line2=addr.line2,
        city=addr.city,
        state=addr.state,
        pincode=addr.pincode,
        lat=lat,
        lng=lng,
        is_default=addr.is_default,
        created_at=addr.created_at,
    )


def _compute_delivery_fee(
    base: Decimal, distance_km: float, *, free_delivery: bool
) -> Decimal:
    """Compute delivery fee per contract rule.

    ``delivery_fee = base + max(0, distance_km - 3) * 10`` rounded to 2dp.
    Overridden to ``0`` when ``free_delivery=True`` (e.g. FREESHIP promo).
    """
    if free_delivery:
        return _money(_ZERO)
    extra_km = max(0.0, distance_km - 3.0)
    extra = Decimal(str(extra_km)) * Decimal("10")
    return _money(base + extra)


def _event_to_schema(event: OrderStatusEvent) -> OrderStatusEventOut:
    return OrderStatusEventOut.model_validate(event)


def _items_to_schemas(items: list[OrderItem]) -> list[OrderItemOut]:
    return [OrderItemOut.model_validate(i) for i in items]


def _sum_item_count(items: list[OrderItem]) -> int:
    return sum(int(i.qty or 0) for i in items)


def _build_detail(
    order: Order,
    *,
    address_out: AddressOut,
    restaurant_name: str,
    restaurant_image: str | None,
) -> OrderDetailOut:
    """Assemble the :class:`OrderDetailOut` response from an eager-loaded Order."""
    events_sorted = sorted(order.status_events or [], key=lambda e: e.created_at)
    return OrderDetailOut(
        id=order.id,
        restaurant_name=restaurant_name,
        restaurant_image=restaurant_image,
        total=order.total,
        item_count=_sum_item_count(order.items or []),
        status=order.status,
        placed_at=order.placed_at,
        delivered_at=order.delivered_at,
        items=_items_to_schemas(order.items or []),
        address=address_out,
        subtotal=order.subtotal,
        discount=order.discount,
        delivery_fee=order.delivery_fee,
        tax=order.tax,
        payment_method=order.payment_method,
        payment_status=order.payment_status,
        promo_code=order.promo_code,
        notes=order.notes,
        share_token=order.share_token,
        events=[_event_to_schema(e) for e in events_sorted],
    )


async def _load_order_detail(
    db: AsyncSession, *, order_id: UUID, user_id: UUID | None = None
) -> Order:
    """Load an Order with all relationships needed for detail rendering.

    When ``user_id`` is supplied, enforces ownership (404 if not caller's).
    Without ``user_id`` returns the raw order — used by the public
    share-token track endpoint.
    """
    stmt = (
        select(Order)
        .options(
            selectinload(Order.items),
            selectinload(Order.status_events),
            selectinload(Order.restaurant),
            selectinload(Order.address),
        )
        .where(Order.id == order_id)
    )
    if user_id is not None:
        stmt = stmt.where(Order.user_id == user_id)
    result = await db.execute(stmt)
    order = result.scalar_one_or_none()
    if order is None:
        raise NotFoundError("Order not found", code="order_not_found")
    return order


async def _hydrate_address_out(db: AsyncSession, address: Address) -> AddressOut:
    """Decode lat/lng off the order's address and return :class:`AddressOut`."""
    geom = cast(Address.location, Geometry)
    stmt = select(ST_Y(geom).label("lat"), ST_X(geom).label("lng")).where(
        Address.id == address.id
    )
    row = (await db.execute(stmt)).first()
    lat = float(row[0] or 0.0) if row else 0.0
    lng = float(row[1] or 0.0) if row else 0.0
    return _address_to_out(address, lat, lng)


# ---------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------


async def checkout(db: AsyncSession, user: User, data: CheckoutIn) -> OrderDetailOut:
    """Materialize the current cart into an :class:`Order` (atomic).

    Steps (single transaction — the ``get_db`` dep commits on success):

      1. Load the user's cart rows eagerly joined to menu items +
         restaurant. Empty cart -> 409.
      2. Validate the address belongs to the caller (+ decode lat/lng).
      3. Snapshot name/price onto each prospective :class:`OrderItem`.
      4. Compute subtotal, distance (PostGIS), delivery fee, tax, and
         apply the promo (delegated to :mod:`promo_service`).
      5. Insert :class:`Order` + :class:`OrderItem` rows + an initial
         ``placed`` :class:`OrderStatusEvent`.
      6. Delete the caller's cart rows inline (we don't call
         cart_service — we own this transaction).
      7. Reload the order with its relationships and return an
         :class:`OrderDetailOut` for immediate UI rendering.
    """
    # 1) Load cart with menu items + restaurant so we can snapshot + compute.
    cart_stmt = (
        select(CartItem)
        .options(
            selectinload(CartItem.menu_item).selectinload(MenuItem.restaurant),
            selectinload(CartItem.restaurant),
        )
        .where(CartItem.user_id == user.id)
    )
    cart_rows = (await db.execute(cart_stmt)).scalars().all()
    if not cart_rows:
        raise ConflictError("Cart is empty", code="cart_empty")

    # Cart is single-restaurant by business rule (enforced by cart service).
    restaurant_ids = {row.restaurant_id for row in cart_rows}
    if len(restaurant_ids) != 1:
        # Defensive guard — shouldn't happen, but cheaper to 409 than
        # silently place a corrupted order.
        raise ConflictError(
            "Cart contains items from multiple restaurants",
            code="cart_multi_restaurant",
        )
    restaurant: Restaurant = cart_rows[0].restaurant
    restaurant_id = restaurant.id

    # 2) Address belongs to caller? Also pulls lat/lng for PostGIS distance.
    address, addr_lat, addr_lng = await _load_address_for_user(
        db, user_id=user.id, address_id=data.address_id
    )

    # 3) Snapshot + subtotal.
    subtotal = _ZERO
    prepared_items: list[dict[str, Any]] = []
    for row in cart_rows:
        menu = row.menu_item
        if menu is None:
            # Menu item vanished between add-to-cart and checkout. Fail
            # loudly so the UI can refresh instead of writing garbage.
            raise ConflictError(
                "A menu item in your cart is no longer available",
                code="menu_item_missing",
            )
        price = _money(menu.price)
        qty = int(row.qty or 0)
        if qty <= 0:
            continue
        line_total = _money(price * Decimal(qty))
        subtotal += line_total
        prepared_items.append(
            {
                "menu_item_id": menu.id,
                "name_snapshot": menu.name,
                "price_snapshot": price,
                "qty": qty,
                "options": dict(row.options or {}),
            }
        )
    subtotal = _money(subtotal)

    # 4) Distance via PostGIS (restaurants.location <-> addresses.location,
    #    both geography). ST_Distance over geography returns meters.
    dist_stmt = select(
        ST_Distance(Restaurant.location, Address.location).label("meters")
    ).where(Restaurant.id == restaurant_id, Address.id == address.id)
    dist_row = (await db.execute(dist_stmt)).first()
    distance_m = float(dist_row[0] or 0.0) if dist_row else 0.0
    distance_km = distance_m / 1000.0

    # Promo validation (Agent 5). Contract: returns (discount, free_delivery).
    discount: Decimal = _ZERO
    free_delivery = False
    applied_code: str | None = None
    if data.promo_code:
        discount, free_delivery = await promo_service.validate_and_apply(
            code=data.promo_code,
            subtotal=subtotal,
            user_id=user.id,
            db=db,
        )
        discount = _money(discount)
        # Never let the discount exceed the subtotal.
        if discount > subtotal:
            discount = subtotal
        # Record the code on the order only when it actually moved the needle.
        if discount > _ZERO or free_delivery:
            applied_code = data.promo_code

    delivery_fee = _compute_delivery_fee(
        _money(restaurant.delivery_fee_base),
        distance_km,
        free_delivery=free_delivery,
    )
    tax = _money(subtotal * Decimal("0.05"))
    total = _money(subtotal - discount + delivery_fee + tax)
    if total < _ZERO:
        total = _ZERO

    # 5) Insert order + items + initial status event.
    share_token = uuid4().hex
    order = Order(
        user_id=user.id,
        restaurant_id=restaurant_id,
        address_id=address.id,
        status=OrderStatus.PLACED,
        subtotal=subtotal,
        discount=discount,
        delivery_fee=delivery_fee,
        tax=tax,
        total=total,
        payment_method=data.payment_method,
        payment_status=PaymentStatus.PENDING,
        promo_code=applied_code,
        notes=data.notes,
        share_token=share_token,
    )
    db.add(order)
    await db.flush()  # populate order.id for FK inserts

    for item in prepared_items:
        db.add(
            OrderItem(
                order_id=order.id,
                menu_item_id=item["menu_item_id"],
                name_snapshot=item["name_snapshot"],
                price_snapshot=item["price_snapshot"],
                qty=item["qty"],
                options=item["options"],
            )
        )
    db.add(
        OrderStatusEvent(
            order_id=order.id,
            status=OrderStatus.PLACED,
            note=None,
            actor_type=ActorType.CUSTOMER,
            actor_id=user.id,
        )
    )

    # 6) Delete the cart rows inline (we own the transaction; don't import
    #    cart_service — the contract says to drop rows directly here).
    await db.execute(delete(CartItem).where(CartItem.user_id == user.id))

    await db.flush()

    # 7) Reload with relationships + build the detail projection.
    reloaded = await _load_order_detail(db, order_id=order.id, user_id=user.id)
    address_out = _address_to_out(address, addr_lat, addr_lng)
    return _build_detail(
        reloaded,
        address_out=address_out,
        restaurant_name=restaurant.name,
        restaurant_image=restaurant.cover_url or restaurant.image_url,
    )


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

StatusFilter = Literal["all", "active", "past", "cancelled", "delivered"]


def _resolve_status_filter(
    status_filter: StatusFilter | OrderStatus | str | None,
) -> list[OrderStatus] | None:
    """Normalize ``?status=`` into a list of concrete states, or None for all.

    Accepts the three canonical grouping aliases (``all``, ``active``,
    ``past``) plus any raw :class:`OrderStatus` value (``delivered``,
    ``cancelled``, etc.). Unknown values degrade to "no filter" rather
    than throwing — the router already validates at the boundary.
    """
    if status_filter is None or status_filter == "all":
        return None
    if isinstance(status_filter, OrderStatus):
        return [status_filter]
    value = str(status_filter).lower()
    if value == "active":
        return list(_ACTIVE_STATES)
    if value == "past":
        return [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.FAILED]
    try:
        return [OrderStatus(value)]
    except ValueError:
        return None


async def list_orders(
    db: AsyncSession,
    user: User,
    *,
    status_filter: StatusFilter | OrderStatus | str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> PageOut[OrderListItem]:
    """Return a page of :class:`OrderListItem` tiles for the caller.

    Sorted newest-first by ``placed_at``. ``page_size`` is clamped to 50
    (consistent with the restaurants listing).
    """
    page = max(1, page)
    page_size = max(1, min(50, page_size))
    offset = (page - 1) * page_size
    statuses = _resolve_status_filter(status_filter)

    stmt = (
        select(Order)
        .options(
            selectinload(Order.items),
            selectinload(Order.restaurant),
        )
        .where(Order.user_id == user.id)
    )
    if statuses:
        stmt = stmt.where(Order.status.in_(statuses))
    stmt = stmt.order_by(Order.placed_at.desc()).offset(offset).limit(page_size + 1)

    rows = (await db.execute(stmt)).scalars().all()
    has_next = len(rows) > page_size
    page_rows = rows[:page_size]

    count_stmt = (
        select(func.count()).select_from(Order).where(Order.user_id == user.id)
    )
    if statuses:
        count_stmt = count_stmt.where(Order.status.in_(statuses))
    total = int((await db.execute(count_stmt)).scalar_one() or 0)

    items: list[OrderListItem] = []
    for order in page_rows:
        restaurant = order.restaurant
        items.append(
            OrderListItem(
                id=order.id,
                restaurant_name=restaurant.name if restaurant else "",
                restaurant_image=(restaurant.cover_url or restaurant.image_url)
                if restaurant
                else None,
                total=order.total,
                item_count=_sum_item_count(order.items or []),
                status=order.status,
                placed_at=order.placed_at,
                delivered_at=order.delivered_at,
            )
        )

    return PageOut[OrderListItem](
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        has_next=has_next,
    )


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------


async def get_order(
    db: AsyncSession, user: User, order_id: UUID
) -> OrderDetailOut:
    """Return :class:`OrderDetailOut` or 404 if not found / not caller's."""
    order = await _load_order_detail(db, order_id=order_id, user_id=user.id)
    restaurant = order.restaurant
    address_out = await _hydrate_address_out(db, order.address)
    return _build_detail(
        order,
        address_out=address_out,
        restaurant_name=restaurant.name if restaurant else "",
        restaurant_image=(restaurant.cover_url or restaurant.image_url)
        if restaurant
        else None,
    )


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------


async def cancel_order(
    db: AsyncSession, user: User, order_id: UUID
) -> OrderDetailOut:
    """Cancel an order in ``{placed, confirmed}``. Else 409.

    Appends an :class:`OrderStatusEvent` with ``status=cancelled`` and
    stamps ``cancelled_at`` on the order. Refunds / payment reversal are
    Phase 4 — this endpoint only writes state.
    """
    order = await _load_order_detail(db, order_id=order_id, user_id=user.id)
    if order.status not in _CANCELLABLE_STATES:
        raise ConflictError(
            f"Order cannot be cancelled in status '{order.status.value}'",
            code="order_not_cancellable",
        )

    order.status = OrderStatus.CANCELLED
    order.cancelled_at = func.now()  # type: ignore[assignment]
    db.add(
        OrderStatusEvent(
            order_id=order.id,
            status=OrderStatus.CANCELLED,
            note="Cancelled by customer",
            actor_type=ActorType.CUSTOMER,
            actor_id=user.id,
        )
    )
    await db.flush()

    reloaded = await _load_order_detail(db, order_id=order.id, user_id=user.id)
    restaurant = reloaded.restaurant
    address_out = await _hydrate_address_out(db, reloaded.address)
    return _build_detail(
        reloaded,
        address_out=address_out,
        restaurant_name=restaurant.name if restaurant else "",
        restaurant_image=(restaurant.cover_url or restaurant.image_url)
        if restaurant
        else None,
    )


# ---------------------------------------------------------------------------
# Review
# ---------------------------------------------------------------------------


async def create_review(
    db: AsyncSession, user: User, order_id: UUID, data: ReviewCreateIn
) -> Review:
    """Attach a :class:`Review` to a delivered order. Returns the ORM row.

    Enforces:
      - Order belongs to the caller (404 otherwise).
      - Order status is ``delivered`` (409 otherwise).
      - One review per order (422 on duplicate — the DB unique index
        would fire on conflict, but we check first for a friendlier error).
    """
    order_stmt = (
        select(Order)
        .options(selectinload(Order.review))
        .where(Order.id == order_id, Order.user_id == user.id)
        .limit(1)
    )
    order = (await db.execute(order_stmt)).scalar_one_or_none()
    if order is None:
        raise NotFoundError("Order not found", code="order_not_found")
    if order.status != OrderStatus.DELIVERED:
        raise ConflictError(
            "Only delivered orders can be reviewed",
            code="order_not_delivered",
        )
    if order.review is not None:
        raise ValidationError_(
            "Order already has a review",
            code="review_already_exists",
        )

    review = Review(
        order_id=order.id,
        user_id=user.id,
        restaurant_id=order.restaurant_id,
        rating=int(data.rating),
        comment=data.comment,
        images=list(data.images or []),
    )
    db.add(review)
    await db.flush()
    return review


# ---------------------------------------------------------------------------
# Track
# ---------------------------------------------------------------------------


async def get_track(
    db: AsyncSession,
    *,
    order_id: UUID | None = None,
    share_token: str | None = None,
    user: User | None = None,
) -> OrderTrackOut:
    """Return a lightweight :class:`OrderTrackOut` for polling / WS fallback.

    Identification rules:
      - If ``share_token`` is provided, lookup is public (no auth check).
      - Else ``order_id`` + authenticated ``user`` → ownership enforced.
      - At least one of the two must be provided; else 404.

    ``partner_location`` and ``eta_minutes`` are placeholders in Phase 3
    (the partner table + location table aren't populated yet). They're
    returned as ``None`` so the frontend's shape is already stable when
    Phase 4 lights them up.
    """
    if share_token:
        stmt = (
            select(Order)
            .options(selectinload(Order.status_events))
            .where(Order.share_token == share_token)
            .limit(1)
        )
        order = (await db.execute(stmt)).scalar_one_or_none()
    elif order_id is not None and user is not None:
        stmt = (
            select(Order)
            .options(selectinload(Order.status_events))
            .where(Order.id == order_id, Order.user_id == user.id)
            .limit(1)
        )
        order = (await db.execute(stmt)).scalar_one_or_none()
    else:
        order = None

    if order is None:
        raise NotFoundError("Order not found", code="order_not_found")

    events_sorted = sorted(order.status_events or [], key=lambda e: e.created_at)
    return OrderTrackOut(
        status=order.status,
        events=[_event_to_schema(e) for e in events_sorted],
        partner_location=None,
        eta_minutes=None,
    )

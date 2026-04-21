"""Admin menu-item service — create / update / delete.

Ownership is delegated to the item's parent restaurant:
    user may edit a menu item iff they can edit ``item.restaurant`` —
    i.e. they own the restaurant OR they are an admin.

``category_id`` is validated opportunistically: if the caller supplies a
value we verify it exists. If they supply ``None`` we treat it as
"uncategorised" (the column is nullable on the model).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from zerozero_api.core.errors import NotFoundError, PermissionError_, ValidationError_
from zerozero_api.domain.category import Category
from zerozero_api.domain.enums import UserRole
from zerozero_api.domain.menu import MenuItem
from zerozero_api.domain.restaurant import Restaurant
from zerozero_api.domain.user import User
from zerozero_api.schemas.admin import MenuItemCreateIn, MenuItemUpdateIn


__all__ = [
    "create_menu_item",
    "delete_menu_item",
    "update_menu_item",
]


def _ensure_can_edit(user: User, restaurant: Restaurant) -> None:
    """Raise ``PermissionError_`` if ``user`` can't edit this restaurant."""
    if user.role == UserRole.ADMIN:
        return
    if restaurant.owner_id is not None and restaurant.owner_id == user.id:
        return
    raise PermissionError_("You do not own this restaurant")


async def _load_restaurant(db: AsyncSession, restaurant_id: UUID) -> Restaurant:
    """Fetch restaurant or raise 404."""
    result = await db.execute(
        select(Restaurant).where(Restaurant.id == restaurant_id)
    )
    restaurant = result.scalar_one_or_none()
    if restaurant is None:
        raise NotFoundError("Restaurant not found")
    return restaurant


async def _load_menu_item_with_restaurant(
    db: AsyncSession, menu_item_id: UUID
) -> MenuItem:
    """Fetch a menu item with its parent restaurant eagerly loaded.

    Needed for the ownership check, which lives on the restaurant row.
    """
    result = await db.execute(
        select(MenuItem)
        .options(selectinload(MenuItem.restaurant))
        .where(MenuItem.id == menu_item_id)
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise NotFoundError("Menu item not found")
    return item


async def _validate_category(db: AsyncSession, category_id: UUID | None) -> None:
    if category_id is None:
        return
    exists = (
        await db.execute(
            select(Category.id).where(Category.id == category_id)
        )
    ).scalar_one_or_none()
    if exists is None:
        raise ValidationError_(
            "category not found",
            extra={"field": "category_id", "value": str(category_id)},
        )


async def create_menu_item(
    db: AsyncSession,
    user: User,
    data: MenuItemCreateIn,
) -> MenuItem:
    """Create a menu item under the restaurant identified by ``data.restaurant_id``."""
    restaurant = await _load_restaurant(db, data.restaurant_id)
    _ensure_can_edit(user, restaurant)
    await _validate_category(db, data.category_id)

    item = MenuItem(
        restaurant_id=restaurant.id,
        category_id=data.category_id,
        name=data.name,
        description=data.description,
        price=data.price,
        image_url=data.image_url,
        is_veg=data.is_veg,
        is_available=data.is_available,
        tags=list(data.tags or []),
        variants=dict(data.variants) if data.variants is not None else {},
        sort_order=data.sort_order,
    )
    db.add(item)
    await db.flush()

    # Reload with relations if the response needs them (category is
    # already selectin on the model; this triggers the fetch).
    result = await db.execute(
        select(MenuItem)
        .options(
            selectinload(MenuItem.category),
            selectinload(MenuItem.restaurant),
        )
        .where(MenuItem.id == item.id)
    )
    fresh = result.scalar_one()
    return fresh


async def update_menu_item(
    db: AsyncSession,
    user: User,
    menu_item_id: UUID,
    data: MenuItemUpdateIn,
) -> MenuItem:
    """Partial update. Ownership checked via the parent restaurant."""
    item = await _load_menu_item_with_restaurant(db, menu_item_id)
    _ensure_can_edit(user, item.restaurant)

    payload: dict[str, Any] = data.model_dump(exclude_unset=True)

    if "category_id" in payload:
        await _validate_category(db, payload["category_id"])

    # Tags / variants need coerced containers so server_default ARRAY/jsonb
    # stay well-formed.
    if "tags" in payload and payload["tags"] is not None:
        payload["tags"] = list(payload["tags"])
    if "variants" in payload and payload["variants"] is not None:
        payload["variants"] = dict(payload["variants"])

    for field, value in payload.items():
        setattr(item, field, value)

    await db.flush()

    # Reload to refresh any computed relationships.
    result = await db.execute(
        select(MenuItem)
        .options(
            selectinload(MenuItem.category),
            selectinload(MenuItem.restaurant),
        )
        .where(MenuItem.id == item.id)
    )
    return result.scalar_one()


async def delete_menu_item(
    db: AsyncSession,
    user: User,
    menu_item_id: UUID,
) -> None:
    """Hard-delete the menu item. Cart/order rows reference the item FK
    with their own semantics — we do *not* cascade here; the FK constraint
    on ``menu_items.id`` will raise if there are dependent rows. In
    practice that's rare (items are usually marked unavailable first)."""
    item = await _load_menu_item_with_restaurant(db, menu_item_id)
    _ensure_can_edit(user, item.restaurant)

    await db.delete(item)
    await db.flush()

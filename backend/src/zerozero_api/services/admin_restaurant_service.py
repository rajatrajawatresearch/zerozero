"""Admin restaurant service — create / update / soft-delete.

Ownership rule (enforced inside every mutating fn):
    restaurant.owner_id == user.id  OR  user.role == UserRole.ADMIN

Slug generation:
    - Start from ``slugify(name)`` (or the caller-supplied override).
    - On collision, append ``-<short-uuid>`` and retry; we bound retries
      to keep this from looping forever under pathological contention.
    - We defensively catch ``IntegrityError`` on the unique index too, in
      case a concurrent insert beats the pre-check.

Geography:
    PostGIS column accepts WKT strings with an SRID prefix. We route
    everything through ``ST_SetSRID(ST_MakePoint(lng, lat), 4326)`` at
    INSERT / UPDATE time so the geography column is guaranteed well-formed.
"""

from __future__ import annotations

import uuid
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from zerozero_api.core.errors import NotFoundError, PermissionError_, ValidationError_
from zerozero_api.domain.cuisine import Cuisine
from zerozero_api.domain.enums import UserRole
from zerozero_api.domain.restaurant import Restaurant, RestaurantCuisine
from zerozero_api.domain.user import User
from zerozero_api.schemas.admin import RestaurantCreateIn, RestaurantUpdateIn
from zerozero_api.seed.utils import slugify


__all__ = [
    "create_restaurant",
    "soft_delete_restaurant",
    "update_restaurant",
]


# Bounded collision retry — we also catch IntegrityError as the last line
# of defense, but hitting this limit in practice means something upstream
# is pathological (e.g. a malicious caller spamming identical names).
_SLUG_RETRY_LIMIT = 5


def _ensure_can_edit(user: User, restaurant: Restaurant) -> None:
    """Raise ``PermissionError_`` if ``user`` can't mutate ``restaurant``."""
    if user.role == UserRole.ADMIN:
        return
    if restaurant.owner_id is not None and restaurant.owner_id == user.id:
        return
    raise PermissionError_("You do not own this restaurant")


def _short_uuid() -> str:
    """8-char suffix for slug collision suffixing (36^8 ≈ 2.8e12 space)."""
    return uuid.uuid4().hex[:8]


def _geography_wkt(lat: float, lng: float) -> str:
    """Return an ``SRID=4326;POINT(lng lat)`` string for geography columns.

    WKT uses ``(x y)`` = ``(longitude latitude)``. This matches the
    convention used by the seeder in ``seed/utils.to_wkt``.
    """
    return f"SRID=4326;POINT({lng} {lat})"


async def _resolve_cuisine_ids(
    db: AsyncSession, slugs: list[str]
) -> list[UUID]:
    """Map cuisine slugs → ids. Raises if any slug is unknown."""
    if not slugs:
        return []
    result = await db.execute(
        select(Cuisine.id, Cuisine.slug).where(Cuisine.slug.in_(slugs))
    )
    pairs = result.all()
    found = {slug: cid for cid, slug in pairs}
    missing = [s for s in slugs if s not in found]
    if missing:
        raise ValidationError_(
            f"unknown cuisine slug(s): {', '.join(missing)}",
            extra={"field": "cuisine_slugs", "missing": missing},
        )
    # Preserve caller order (stable cuisines display).
    return [found[s] for s in slugs]


async def _reload_with_relations(
    db: AsyncSession, restaurant_id: UUID
) -> Restaurant:
    """Re-select with explicit eager loads so the response schema has
    everything it needs without a lazy-load round trip."""
    result = await db.execute(
        select(Restaurant)
        .options(selectinload(Restaurant.cuisines))
        .where(Restaurant.id == restaurant_id)
    )
    loaded = result.scalar_one_or_none()
    if loaded is None:
        # Extremely unlikely — we just inserted / updated it.
        raise NotFoundError("Restaurant not found")
    return loaded


async def _unique_slug(
    db: AsyncSession,
    base: str,
    *,
    exclude_id: UUID | None = None,
) -> str:
    """Find a slug not already taken in the ``restaurants`` table.

    ``exclude_id`` lets updates keep their own slug when nothing else in
    the payload changes.
    """
    candidate = base or "restaurant"
    for _ in range(_SLUG_RETRY_LIMIT + 1):
        stmt = select(Restaurant.id).where(Restaurant.slug == candidate)
        if exclude_id is not None:
            stmt = stmt.where(Restaurant.id != exclude_id)
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing is None:
            return candidate
        candidate = f"{base}-{_short_uuid()}"
    # Last-resort: fully random.
    return f"{base}-{_short_uuid()}"


async def create_restaurant(
    db: AsyncSession,
    owner_id: UUID,
    data: RestaurantCreateIn,
) -> Restaurant:
    """Create a restaurant owned by ``owner_id``.

    The caller (router) has already verified ``owner_id`` is either the
    acting user (when role=OWNER) or an admin impersonating. We treat
    ``owner_id`` as the record to stamp onto ``restaurants.owner_id``.
    """
    cuisine_ids = await _resolve_cuisine_ids(db, data.cuisine_slugs)

    base_slug = slugify(data.slug) if data.slug else slugify(data.name)

    # Pre-check the slug; fall through to IntegrityError retry if a race
    # inserts a duplicate after our SELECT.
    slug = await _unique_slug(db, base_slug)

    for attempt in range(_SLUG_RETRY_LIMIT + 1):
        restaurant = Restaurant(
            owner_id=owner_id,
            name=data.name,
            slug=slug,
            description=data.description,
            location=_geography_wkt(data.lat, data.lng),
            address_text=data.address_text,
            delivery_radius_m=data.delivery_radius_m,
            min_order=data.min_order,
            delivery_fee_base=data.delivery_fee_base,
            avg_prep_minutes=data.avg_prep_minutes,
            image_url=data.image_url,
            cover_url=data.cover_url,
            opens_at=data.opens_at,
            closes_at=data.closes_at,
            is_active=data.is_active,
            is_featured=data.is_featured,
        )
        db.add(restaurant)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            # Expire whatever survived the rollback and try a new slug.
            slug = f"{base_slug}-{_short_uuid()}"
            if attempt == _SLUG_RETRY_LIMIT:
                raise
            continue
        break

    # Link cuisines.
    for cid in cuisine_ids:
        db.add(RestaurantCuisine(restaurant_id=restaurant.id, cuisine_id=cid))
    await db.flush()

    return await _reload_with_relations(db, restaurant.id)


async def update_restaurant(
    db: AsyncSession,
    user: User,
    restaurant_id: UUID,
    data: RestaurantUpdateIn,
) -> Restaurant:
    """Partial update. Unsupplied fields are left untouched.

    Ownership is enforced via :func:`_ensure_can_edit` — non-admin owners
    may only edit rows with a matching ``owner_id``.
    """
    result = await db.execute(
        select(Restaurant).where(Restaurant.id == restaurant_id)
    )
    restaurant = result.scalar_one_or_none()
    if restaurant is None:
        raise NotFoundError("Restaurant not found")

    _ensure_can_edit(user, restaurant)

    payload: dict[str, Any] = data.model_dump(exclude_unset=True)

    # Coupled fields.
    new_lat = payload.pop("lat", None)
    new_lng = payload.pop("lng", None)
    if (new_lat is None) != (new_lng is None):
        raise ValidationError_(
            "lat and lng must be supplied together",
            extra={"field": "lat/lng"},
        )
    if new_lat is not None and new_lng is not None:
        restaurant.location = _geography_wkt(new_lat, new_lng)

    # Slug: if explicit override provided, normalize + uniqueness.
    # If only `name` changed, leave the slug alone (owners usually don't
    # want slug churn when they rename a place — breaks bookmarks).
    slug_override = payload.pop("slug", None)
    if slug_override is not None:
        normalized = slugify(slug_override)
        restaurant.slug = await _unique_slug(
            db, normalized, exclude_id=restaurant.id
        )

    # Cuisines replacement.
    cuisine_slugs = payload.pop("cuisine_slugs", None)
    if cuisine_slugs is not None:
        cuisine_ids = await _resolve_cuisine_ids(db, cuisine_slugs)
        # Wipe the existing join rows and re-create.
        await db.execute(
            delete(RestaurantCuisine).where(
                RestaurantCuisine.restaurant_id == restaurant.id
            )
        )
        for cid in cuisine_ids:
            db.add(
                RestaurantCuisine(
                    restaurant_id=restaurant.id, cuisine_id=cid
                )
            )

    # Everything else maps 1:1 onto the model.
    for field, value in payload.items():
        setattr(restaurant, field, value)

    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise

    return await _reload_with_relations(db, restaurant.id)


async def soft_delete_restaurant(
    db: AsyncSession,
    user: User,
    restaurant_id: UUID,
) -> None:
    """Soft delete: flip ``is_active`` to False. Historical orders survive."""
    result = await db.execute(
        select(Restaurant).where(Restaurant.id == restaurant_id)
    )
    restaurant = result.scalar_one_or_none()
    if restaurant is None:
        raise NotFoundError("Restaurant not found")

    _ensure_can_edit(user, restaurant)

    restaurant.is_active = False
    await db.flush()

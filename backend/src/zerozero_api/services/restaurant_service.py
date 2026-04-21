"""Restaurant discovery / detail / menu service.

All business logic for the public restaurant endpoints lives here. The
router layer is thin — parses query params, forwards to this module,
and wraps the return in ``response_model``.

Responsibilities:

  - :func:`list_restaurants` — filtered, ranked, paginated homepage grid
    driven by PostGIS + pg_trgm. Computes ``distance_km``,
    ``delivers_here``, and ``is_open`` per row before returning.
  - :func:`get_restaurant_detail` — single restaurant by slug.
  - :func:`get_restaurant_menu` — grouped menu (categories → items).

Design notes:
  - Always ``select()`` with ``selectinload`` on cuisines so we emit a
    single ``IN`` query instead of N+1.
  - Geo filters only engage when the caller passes ``lat`` / ``lng``.
    Without coordinates the "distance" sort silently falls back to
    ``rating`` so the client never sees a 422.
  - Money columns are :class:`~decimal.Decimal` end-to-end; the schema
    layer serializes to string on the way out.
  - ``is_open`` is recomputed in Python from the current UTC time
    instead of a SQL expression — it's cheap, avoids portability
    issues, and handles the cross-midnight case uniformly.
"""

from __future__ import annotations

from datetime import datetime, time, timezone
from typing import Any, Literal, Sequence

from geoalchemy2 import Geography
from geoalchemy2.shape import to_shape
from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from zerozero_api.core.errors import NotFoundError
from zerozero_api.domain.category import Category
from zerozero_api.domain.cuisine import Cuisine
from zerozero_api.domain.menu import MenuItem
from zerozero_api.domain.restaurant import Restaurant, RestaurantCuisine
from zerozero_api.schemas.category import CategoryOut
from zerozero_api.schemas.common import PageOut
from zerozero_api.schemas.cuisine import CuisineOut
from zerozero_api.schemas.menu import MenuCategory, MenuItemOut, RestaurantMenu
from zerozero_api.schemas.restaurant import RestaurantCard, RestaurantDetail

__all__ = [
    "SortOption",
    "list_restaurants",
    "get_restaurant_detail",
    "get_restaurant_menu",
]

SortOption = Literal["distance", "rating", "popular", "new"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_utc_time() -> time:
    """Return the current UTC wall-clock ``time`` (no date component).

    Restaurants store ``opens_at`` / ``closes_at`` as naive ``time``
    columns — by convention they're interpreted in UTC for Phase 2.
    """
    return datetime.now(tz=timezone.utc).time()


def _is_open_now(opens_at: time | None, closes_at: time | None, *, now: time | None = None) -> bool:
    """Return True if ``now`` falls inside the ``[opens_at, closes_at)`` window.

    Handles the cross-midnight case: if ``closes_at <= opens_at`` the window
    is treated as spanning midnight (e.g. 22:00 → 03:00 means "open from
    22:00 to 03:00 the next day"). When either bound is null we treat the
    restaurant as "always open" (Phase 2 fallback — richer scheduling can
    come later).
    """
    if opens_at is None or closes_at is None:
        return True
    current = now or _now_utc_time()
    if closes_at > opens_at:
        return opens_at <= current < closes_at
    # Cross-midnight window.
    return current >= opens_at or current < closes_at


def _cuisines_to_schemas(cuisines: Sequence[Cuisine]) -> list[CuisineOut]:
    return [CuisineOut.model_validate(c) for c in cuisines]


def _build_card(
    row: Restaurant,
    *,
    distance_m: float | None,
    now_time: time,
) -> RestaurantCard:
    """Assemble a :class:`RestaurantCard` from an ORM row + a distance in meters."""
    distance_km = None
    delivers = False
    if distance_m is not None:
        # ``ST_Distance`` over Geography returns meters.
        distance_km = round(distance_m / 1000.0, 3)
        delivers = distance_m <= float(row.delivery_radius_m)

    return RestaurantCard(
        id=row.id,
        slug=row.slug,
        name=row.name,
        cover_url=row.cover_url,
        cuisines=_cuisines_to_schemas(row.cuisines),
        rating_avg=row.rating_avg,
        rating_count=row.rating_count,
        avg_prep_minutes=row.avg_prep_minutes,
        distance_km=distance_km,
        delivers_here=delivers,
        is_open=_is_open_now(row.opens_at, row.closes_at, now=now_time),
        min_order=row.min_order,
        delivery_fee_base=row.delivery_fee_base,
    )


def _build_detail(row: Restaurant, *, now_time: time) -> RestaurantDetail:
    """Assemble a :class:`RestaurantDetail` from an ORM row (no distance context)."""
    # Pull lat/lng out of the Geography column via shapely.
    point = to_shape(row.location)
    lng = float(point.x)
    lat = float(point.y)

    # `opens_at`/`closes_at` are required in the response contract but
    # nullable on the model — default to 00:00 if missing so the
    # response still validates and the UI can treat it as "always open".
    opens_at = row.opens_at or time(0, 0)
    closes_at = row.closes_at or time(0, 0)

    return RestaurantDetail(
        id=row.id,
        slug=row.slug,
        name=row.name,
        cover_url=row.cover_url,
        cuisines=_cuisines_to_schemas(row.cuisines),
        rating_avg=row.rating_avg,
        rating_count=row.rating_count,
        avg_prep_minutes=row.avg_prep_minutes,
        distance_km=None,
        delivers_here=False,
        is_open=_is_open_now(row.opens_at, row.closes_at, now=now_time),
        min_order=row.min_order,
        delivery_fee_base=row.delivery_fee_base,
        description=row.description,
        image_url=row.image_url,
        address_text=row.address_text,
        lat=lat,
        lng=lng,
        opens_at=opens_at,
        closes_at=closes_at,
        is_featured=row.is_featured,
    )


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


async def list_restaurants(
    db: AsyncSession,
    *,
    lat: float | None = None,
    lng: float | None = None,
    cuisine_slugs: Sequence[str] | None = None,
    q: str | None = None,
    veg: bool = False,
    sort: SortOption = "distance",
    page: int = 1,
    page_size: int = 20,
) -> PageOut[RestaurantCard]:
    """Discover restaurants. See ``docs/PHASE2_CONTRACTS.md`` for semantics.

    The function returns a :class:`PageOut` envelope with computed fields
    already assembled on each item so the router can pass it straight to
    ``response_model``.
    """
    page = max(1, page)
    page_size = max(1, min(50, page_size))
    offset = (page - 1) * page_size

    # Normalize whitespace in the text query — drop empty strings so we
    # don't waste a pg_trgm similarity hit on "".
    q_clean = (q or "").strip() or None
    cuisine_slugs = [s.strip() for s in (cuisine_slugs or []) if s and s.strip()] or None

    has_location = lat is not None and lng is not None

    # ----- Distance expression -----------------------------------------------
    # `ST_Distance(Geography, Geography)` returns meters. We build the point
    # here and reuse it across `ST_DWithin` (filter) and `ST_Distance`
    # (projection + sort).
    distance_m_expr = None
    point_geog = None
    if has_location:
        point_geog = func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326).cast(
            Geography(geometry_type="POINT", srid=4326)
        )
        distance_m_expr = func.ST_Distance(Restaurant.location, point_geog)

    # ----- Base query & projections -----------------------------------------
    # When no coordinates are given we skip the distance projection entirely
    # and lift the raw ``Restaurant`` rows out of the result.
    if has_location and distance_m_expr is not None:
        stmt = select(Restaurant, distance_m_expr.label("distance_m"))
    else:
        stmt = select(Restaurant)
    stmt = stmt.options(selectinload(Restaurant.cuisines))

    # ----- Filters ------------------------------------------------------------
    stmt = stmt.where(Restaurant.is_active.is_(True))

    if has_location and point_geog is not None:
        # Only surface restaurants whose delivery disc covers the caller.
        stmt = stmt.where(
            func.ST_DWithin(
                Restaurant.location,
                point_geog,
                Restaurant.delivery_radius_m,
            )
        )

    if cuisine_slugs:
        stmt = stmt.where(
            exists(
                select(RestaurantCuisine.restaurant_id)
                .join(Cuisine, Cuisine.id == RestaurantCuisine.cuisine_id)
                .where(
                    RestaurantCuisine.restaurant_id == Restaurant.id,
                    Cuisine.slug.in_(cuisine_slugs),
                )
                .correlate(Restaurant)
            )
        )

    if veg:
        # Pure-veg restaurants only. Approximation: *every* cuisine tied to
        # this restaurant must be `is_veg_only`. Done via `NOT EXISTS non-veg`.
        non_veg_exists = (
            select(RestaurantCuisine.restaurant_id)
            .join(Cuisine, Cuisine.id == RestaurantCuisine.cuisine_id)
            .where(
                RestaurantCuisine.restaurant_id == Restaurant.id,
                Cuisine.is_veg_only.is_(False),
            )
            .correlate(Restaurant)
        )
        # Also require that the restaurant has at least one cuisine tagged —
        # otherwise a restaurant with zero cuisines passes the NOT EXISTS
        # trivially, which isn't what the contract means by "all cuisines
        # are veg-only".
        any_cuisine_exists = (
            select(RestaurantCuisine.restaurant_id)
            .where(RestaurantCuisine.restaurant_id == Restaurant.id)
            .correlate(Restaurant)
        )
        stmt = stmt.where(and_(~exists(non_veg_exists), exists(any_cuisine_exists)))

    if q_clean:
        # Combine ILIKE (covers substring) with pg_trgm similarity (typo
        # tolerance). Threshold 0.15 matches the contract.
        similarity_expr = func.similarity(Restaurant.name, q_clean)
        stmt = stmt.where(
            (Restaurant.name.ilike(f"%{q_clean}%")) | (similarity_expr > 0.15)
        )

    # ----- Sort --------------------------------------------------------------
    effective_sort: SortOption = sort
    if sort == "distance" and not has_location:
        # Contract: distance sort only when coords supplied — else rating.
        effective_sort = "rating"

    if effective_sort == "distance" and distance_m_expr is not None:
        stmt = stmt.order_by(distance_m_expr.asc(), Restaurant.rating_avg.desc())
    elif effective_sort == "rating":
        stmt = stmt.order_by(
            Restaurant.rating_avg.desc(),
            Restaurant.rating_count.desc(),
            Restaurant.created_at.desc(),
        )
    elif effective_sort == "popular":
        stmt = stmt.order_by(
            Restaurant.rating_count.desc(),
            Restaurant.rating_avg.desc(),
            Restaurant.created_at.desc(),
        )
    elif effective_sort == "new":
        stmt = stmt.order_by(Restaurant.created_at.desc())

    # ----- Pagination + has_next -------------------------------------------
    # Fetch page_size + 1 to peek at the next page without a second query.
    stmt = stmt.offset(offset).limit(page_size + 1)

    result = await db.execute(stmt)
    if has_location:
        rows = result.all()
    else:
        # Without a distance projection ``execute`` yields plain ``Restaurant``
        # rows; normalize to the same ``(restaurant, distance)`` shape downstream.
        rows = [(row, None) for row in result.scalars().all()]

    has_next = len(rows) > page_size
    page_rows = rows[:page_size]

    # ----- Total count -------------------------------------------------------
    # Separate COUNT so pagination totals stay cheap regardless of page size.
    count_stmt = select(func.count()).select_from(Restaurant).where(
        Restaurant.is_active.is_(True)
    )
    if has_location and point_geog is not None:
        count_stmt = count_stmt.where(
            func.ST_DWithin(
                Restaurant.location,
                point_geog,
                Restaurant.delivery_radius_m,
            )
        )
    if cuisine_slugs:
        count_stmt = count_stmt.where(
            exists(
                select(RestaurantCuisine.restaurant_id)
                .join(Cuisine, Cuisine.id == RestaurantCuisine.cuisine_id)
                .where(
                    RestaurantCuisine.restaurant_id == Restaurant.id,
                    Cuisine.slug.in_(cuisine_slugs),
                )
                .correlate(Restaurant)
            )
        )
    if veg:
        non_veg_exists = (
            select(RestaurantCuisine.restaurant_id)
            .join(Cuisine, Cuisine.id == RestaurantCuisine.cuisine_id)
            .where(
                RestaurantCuisine.restaurant_id == Restaurant.id,
                Cuisine.is_veg_only.is_(False),
            )
            .correlate(Restaurant)
        )
        any_cuisine_exists = (
            select(RestaurantCuisine.restaurant_id)
            .where(RestaurantCuisine.restaurant_id == Restaurant.id)
            .correlate(Restaurant)
        )
        count_stmt = count_stmt.where(
            and_(~exists(non_veg_exists), exists(any_cuisine_exists))
        )
    if q_clean:
        similarity_expr = func.similarity(Restaurant.name, q_clean)
        count_stmt = count_stmt.where(
            (Restaurant.name.ilike(f"%{q_clean}%")) | (similarity_expr > 0.15)
        )

    total_result = await db.execute(count_stmt)
    total = int(total_result.scalar_one() or 0)

    # ----- Build response cards ---------------------------------------------
    now_time = _now_utc_time()
    items: list[RestaurantCard] = []
    for row_tuple in page_rows:
        restaurant: Restaurant = row_tuple[0]
        raw_distance: Any = row_tuple[1] if len(row_tuple) > 1 else None
        distance_m: float | None
        if raw_distance is None:
            distance_m = None
        else:
            try:
                distance_m = float(raw_distance)
            except (TypeError, ValueError):
                distance_m = None
        items.append(_build_card(restaurant, distance_m=distance_m, now_time=now_time))

    return PageOut[RestaurantCard](
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        has_next=has_next,
    )


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------


async def get_restaurant_detail(db: AsyncSession, slug: str) -> RestaurantDetail:
    """Return a single restaurant by slug. Raises :class:`NotFoundError` if missing/inactive."""
    stmt = (
        select(Restaurant)
        .options(selectinload(Restaurant.cuisines))
        .where(Restaurant.slug == slug, Restaurant.is_active.is_(True))
        .limit(1)
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None:
        raise NotFoundError(f"Restaurant '{slug}' not found", code="restaurant_not_found")
    return _build_detail(row, now_time=_now_utc_time())


# ---------------------------------------------------------------------------
# Menu
# ---------------------------------------------------------------------------


async def get_restaurant_menu(db: AsyncSession, slug: str) -> RestaurantMenu:
    """Return the grouped menu for a restaurant.

    Items are grouped by category, with categories ordered by
    ``Category.sort_order`` ascending (then by name for stability) and
    items within each group ordered by ``MenuItem.sort_order`` then name.
    Unavailable items are still returned (the UI greys them out); filtering
    on availability is a client-side concern.

    Uncategorized items (``menu_items.category_id IS NULL``) are bucketed
    into a synthetic "Other" section rendered last.
    """
    # 1) Resolve the restaurant (404 on missing / inactive).
    restaurant_stmt = (
        select(Restaurant.id)
        .where(Restaurant.slug == slug, Restaurant.is_active.is_(True))
        .limit(1)
    )
    restaurant_result = await db.execute(restaurant_stmt)
    restaurant_id = restaurant_result.scalar_one_or_none()
    if restaurant_id is None:
        raise NotFoundError(f"Restaurant '{slug}' not found", code="restaurant_not_found")

    # 2) Fetch items joined to their category (outer join for NULL categories).
    items_stmt = (
        select(MenuItem, Category)
        .join(Category, Category.id == MenuItem.category_id, isouter=True)
        .where(MenuItem.restaurant_id == restaurant_id)
        .order_by(
            Category.sort_order.asc().nulls_last(),
            Category.name.asc().nulls_last(),
            MenuItem.sort_order.asc(),
            MenuItem.name.asc(),
        )
    )
    items_result = await db.execute(items_stmt)
    rows = items_result.all()

    # 3) Group by category UUID, preserving the SQL order.
    grouped: dict[Any, tuple[CategoryOut | None, list[MenuItemOut]]] = {}
    order_trace: list[Any] = []

    for menu_item, category in rows:
        key: Any = category.id if category is not None else None
        if key not in grouped:
            cat_schema = CategoryOut.model_validate(category) if category is not None else None
            grouped[key] = (cat_schema, [])
            order_trace.append(key)
        grouped[key][1].append(MenuItemOut.model_validate(menu_item))

    # 4) Assemble the response. Move the "uncategorized" bucket to the end.
    categories: list[MenuCategory] = []
    for key in order_trace:
        cat, items = grouped[key]
        if cat is None:
            # Synthetic placeholder so the shape still validates.
            continue
        categories.append(MenuCategory(category=cat, items=items))

    if None in grouped:
        _cat, items = grouped[None]
        if items:
            # Synthetic CategoryOut for the "Other" bucket. Uses the all-zero
            # UUID so the frontend can detect and render accordingly.
            from uuid import UUID as _UUID

            placeholder = CategoryOut(
                id=_UUID(int=0),
                name="Other",
                slug="other",
                icon=None,
                sort_order=9999,
            )
            categories.append(MenuCategory(category=placeholder, items=items))

    return RestaurantMenu(restaurant_id=restaurant_id, categories=categories)

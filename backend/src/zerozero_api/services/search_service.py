"""Unified fuzzy search service.

Powers ``GET /search`` — one endpoint, two buckets (restaurants +
menu items). Ranking is driven by Postgres ``pg_trgm``'s ``similarity``
function with a hard ILIKE fallback so exact substring hits always
surface, even when the trigram score sits below the threshold.

Query shape:

  - Restaurants: active rows where ``name ILIKE '%q%'`` or
    ``similarity(name, q) > 0.15``. If ``lat`` / ``lng`` passed, tighten
    with ``ST_DWithin(location, point, delivery_radius_m)`` and project
    distance for the card.
  - Menu items:  the same similarity filter on ``menu_items.name``,
    joined to ``restaurants`` so we can enforce the same "restaurant
    active" rule and exclude unavailable items.

Limits per contract: 10 restaurants, 15 menu items. Results come back
with cuisines already eager-loaded for the ``RestaurantCard`` projection.
"""

from __future__ import annotations

from datetime import time
from typing import Any, Literal, Sequence

from geoalchemy2 import Geography
from sqlalchemy import func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from zerozero_api.domain.menu import MenuItem
from zerozero_api.domain.restaurant import Restaurant
from zerozero_api.schemas.cuisine import CuisineOut
from zerozero_api.schemas.restaurant import RestaurantCard
from zerozero_api.schemas.search import (
    MenuItemSearchHit,
    RestaurantBrief,
    SearchResults,
)

__all__ = ["SearchTypeFilter", "unified_search"]


SearchTypeFilter = Literal["all", "restaurant", "menu_item"]

# Tuned in docs/PHASE3_CONTRACTS.md — keep in sync with restaurant_service.
_SIMILARITY_THRESHOLD: float = 0.15
_RESTAURANT_LIMIT: int = 10
_MENU_ITEM_LIMIT: int = 15


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_utc_time() -> time:
    """Current UTC wall-clock time (shared semantics with restaurant_service)."""
    from datetime import datetime, timezone

    return datetime.now(tz=timezone.utc).time()


def _is_open_now(opens_at: time | None, closes_at: time | None, *, now: time) -> bool:
    """Mirror of :func:`restaurant_service._is_open_now` — kept local to avoid
    importing an underscored helper across modules."""
    if opens_at is None or closes_at is None:
        return True
    if closes_at > opens_at:
        return opens_at <= now < closes_at
    return now >= opens_at or now < closes_at


def _build_card(
    row: Restaurant, *, distance_m: float | None, now_time: time
) -> RestaurantCard:
    """Assemble a :class:`RestaurantCard` — trimmed copy of the helper in
    :mod:`restaurant_service` (identical projection, intentionally duplicated
    so the two services don't couple through a private import)."""
    distance_km: float | None = None
    delivers = False
    if distance_m is not None:
        distance_km = round(distance_m / 1000.0, 3)
        delivers = distance_m <= float(row.delivery_radius_m)

    return RestaurantCard(
        id=row.id,
        slug=row.slug,
        name=row.name,
        cover_url=row.cover_url,
        cuisines=[CuisineOut.model_validate(c) for c in row.cuisines],
        rating_avg=row.rating_avg,
        rating_count=row.rating_count,
        avg_prep_minutes=row.avg_prep_minutes,
        distance_km=distance_km,
        delivers_here=delivers,
        is_open=_is_open_now(row.opens_at, row.closes_at, now=now_time),
        min_order=row.min_order,
        delivery_fee_base=row.delivery_fee_base,
    )


def _coerce_distance(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------


async def unified_search(
    db: AsyncSession,
    q: str,
    lat: float | None = None,
    lng: float | None = None,
    type_filter: SearchTypeFilter = "all",
) -> SearchResults:
    """Run the unified restaurant + menu-item search.

    The router enforces ``len(q) >= 2`` before we get here (422 via FastAPI
    ``Query`` validation) — this function assumes a non-empty, stripped query.
    ``type_filter`` lets the caller restrict to a single bucket; the "other"
    bucket comes back empty rather than raising.
    """
    q_clean = q.strip()
    now_time = _now_utc_time()

    has_location = lat is not None and lng is not None
    point_geog = None
    distance_m_expr = None
    if has_location:
        point_geog = func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326).cast(
            Geography(geometry_type="POINT", srid=4326)
        )
        distance_m_expr = func.ST_Distance(Restaurant.location, point_geog)

    want_restaurants = type_filter in ("all", "restaurant")
    want_menu_items = type_filter in ("all", "menu_item")

    restaurants: list[RestaurantCard] = []
    menu_items: list[MenuItemSearchHit] = []

    # ----- Restaurants ------------------------------------------------------
    if want_restaurants:
        restaurants = await _search_restaurants(
            db,
            q_clean,
            point_geog=point_geog,
            distance_m_expr=distance_m_expr,
            now_time=now_time,
        )

    # ----- Menu items -------------------------------------------------------
    if want_menu_items:
        menu_items = await _search_menu_items(db, q_clean)

    return SearchResults(restaurants=restaurants, menu_items=menu_items)


# ---------------------------------------------------------------------------
# Bucket queries
# ---------------------------------------------------------------------------


async def _search_restaurants(
    db: AsyncSession,
    q: str,
    *,
    point_geog: Any,
    distance_m_expr: Any,
    now_time: time,
) -> list[RestaurantCard]:
    """Top-N restaurant hits ranked by trigram similarity (ILIKE fallback)."""
    similarity_expr = func.similarity(Restaurant.name, q)
    # ``GREATEST(similarity, 0.15)`` keeps ILIKE-only hits (where similarity
    # dips below the threshold) at a sane floor so they still sort above noise.
    rank_expr = func.greatest(similarity_expr, literal(_SIMILARITY_THRESHOLD))

    if distance_m_expr is not None:
        stmt = select(Restaurant, distance_m_expr.label("distance_m"))
    else:
        stmt = select(Restaurant)
    stmt = (
        stmt.options(selectinload(Restaurant.cuisines))
        .where(Restaurant.is_active.is_(True))
        .where(
            (Restaurant.name.ilike(f"%{q}%")) | (similarity_expr > _SIMILARITY_THRESHOLD)
        )
    )

    if point_geog is not None:
        # Only surface restaurants whose delivery disc covers the caller,
        # matching the /restaurants semantics.
        stmt = stmt.where(
            func.ST_DWithin(Restaurant.location, point_geog, Restaurant.delivery_radius_m)
        )

    stmt = stmt.order_by(rank_expr.desc(), Restaurant.rating_avg.desc()).limit(
        _RESTAURANT_LIMIT
    )

    result = await db.execute(stmt)
    if distance_m_expr is not None:
        rows = result.all()
    else:
        rows = [(row, None) for row in result.scalars().all()]

    out: list[RestaurantCard] = []
    for row_tuple in rows:
        restaurant: Restaurant = row_tuple[0]
        raw_distance = row_tuple[1] if len(row_tuple) > 1 else None
        out.append(
            _build_card(
                restaurant,
                distance_m=_coerce_distance(raw_distance),
                now_time=now_time,
            )
        )
    return out


async def _search_menu_items(db: AsyncSession, q: str) -> list[MenuItemSearchHit]:
    """Top-N menu-item hits, joined to their owning restaurant."""
    similarity_expr = func.similarity(MenuItem.name, q)
    rank_expr = func.greatest(similarity_expr, literal(_SIMILARITY_THRESHOLD))

    stmt = (
        select(MenuItem)
        .join(Restaurant, Restaurant.id == MenuItem.restaurant_id)
        .options(selectinload(MenuItem.restaurant))
        .where(Restaurant.is_active.is_(True))
        .where(MenuItem.is_available.is_(True))
        .where((MenuItem.name.ilike(f"%{q}%")) | (similarity_expr > _SIMILARITY_THRESHOLD))
        .order_by(rank_expr.desc(), MenuItem.name.asc())
        .limit(_MENU_ITEM_LIMIT)
    )

    result = await db.execute(stmt)
    items: Sequence[MenuItem] = result.scalars().all()

    out: list[MenuItemSearchHit] = []
    for item in items:
        restaurant = item.restaurant
        brief = RestaurantBrief(
            id=restaurant.id,
            name=restaurant.name,
            slug=restaurant.slug,
            image_url=restaurant.image_url,
        )
        out.append(
            MenuItemSearchHit(
                id=item.id,
                name=item.name,
                price=item.price,
                image_url=item.image_url,
                is_veg=item.is_veg,
                restaurant=brief,
            )
        )
    return out

"""Public restaurants router — discovery, detail, and menu endpoints.

Handlers are intentionally thin: they normalize query parameters (the
contract accepts ``cuisine`` both as repeated query params AND CSV) and
delegate to :mod:`zerozero_api.services.restaurant_service`.

Routes (all mounted under ``{API_V1_PREFIX}``):

  - ``GET /restaurants``             → :class:`PageOut[RestaurantCard]`
  - ``GET /restaurants/{slug}``      → :class:`RestaurantDetail`
  - ``GET /restaurants/{slug}/menu`` → :class:`RestaurantMenu`
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.schemas.common import PageOut
from zerozero_api.schemas.menu import RestaurantMenu
from zerozero_api.schemas.restaurant import RestaurantCard, RestaurantDetail
from zerozero_api.services import restaurant_service

__all__ = ["router"]


router = APIRouter(prefix="/restaurants", tags=["restaurants"])


def _normalize_cuisine_param(values: list[str] | None) -> list[str]:
    """Flatten ``cuisine`` query values.

    Accepts ``cuisine=a&cuisine=b`` **and** ``cuisine=a,b`` (the spec allows
    both). Empty strings are dropped. Returns a de-duplicated list preserving
    first-seen order.
    """
    if not values:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for raw in values:
        if raw is None:
            continue
        for piece in raw.split(","):
            cleaned = piece.strip()
            if not cleaned or cleaned in seen:
                continue
            seen.add(cleaned)
            out.append(cleaned)
    return out


@router.get(
    "",
    response_model=PageOut[RestaurantCard],
    summary="List restaurants",
    description=(
        "Discover restaurants near a location with optional cuisine / veg / "
        "text filters and configurable sort. Geo filters only engage when "
        "both `lat` and `lng` are provided; without coordinates the default "
        "`distance` sort falls back to `rating`."
    ),
)
async def list_restaurants_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    lat: Annotated[
        float | None,
        Query(ge=-90, le=90, description="Caller latitude (WGS84)."),
    ] = None,
    lng: Annotated[
        float | None,
        Query(ge=-180, le=180, description="Caller longitude (WGS84)."),
    ] = None,
    cuisine: Annotated[
        list[str] | None,
        Query(
            alias="cuisine",
            description=(
                "Cuisine slug filter. Accepts repeated params "
                "(`?cuisine=a&cuisine=b`) or a single CSV value (`?cuisine=a,b`)."
            ),
        ),
    ] = None,
    q: Annotated[
        str | None,
        Query(max_length=100, description="Fuzzy name search (ILIKE + pg_trgm)."),
    ] = None,
    veg: Annotated[
        bool,
        Query(description="Filter to restaurants whose *all* cuisines are veg-only."),
    ] = False,
    sort: Annotated[
        Literal["distance", "rating", "popular", "new"],
        Query(description="Ranking: distance (default, needs lat/lng), rating, popular, new."),
    ] = "distance",
    page: Annotated[int, Query(ge=1, description="1-indexed page number.")] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=50, description="Page size (max 50).")
    ] = 20,
) -> PageOut[RestaurantCard]:
    """Return a paginated list of restaurant cards matching the filters."""
    return await restaurant_service.list_restaurants(
        db,
        lat=lat,
        lng=lng,
        cuisine_slugs=_normalize_cuisine_param(cuisine),
        q=q,
        veg=veg,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{slug}",
    response_model=RestaurantDetail,
    summary="Get restaurant detail",
    description=(
        "Return the full public detail for a single active restaurant by slug."
    ),
    responses={404: {"description": "Restaurant not found or inactive."}},
)
async def get_restaurant_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    slug: Annotated[str, Path(min_length=1, max_length=200, description="Restaurant slug.")],
) -> RestaurantDetail:
    """Return one :class:`RestaurantDetail` or raise 404."""
    return await restaurant_service.get_restaurant_detail(db, slug)


@router.get(
    "/{slug}/menu",
    response_model=RestaurantMenu,
    summary="Get restaurant menu",
    description=(
        "Return the grouped menu (categories → items) for a restaurant. "
        "Categories and items come pre-sorted by their respective "
        "`sort_order`; uncategorized items bucket into a synthetic 'Other' "
        "section at the end."
    ),
    responses={404: {"description": "Restaurant not found or inactive."}},
)
async def get_restaurant_menu_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    slug: Annotated[str, Path(min_length=1, max_length=200, description="Restaurant slug.")],
) -> RestaurantMenu:
    """Return the full grouped menu payload."""
    return await restaurant_service.get_restaurant_menu(db, slug)

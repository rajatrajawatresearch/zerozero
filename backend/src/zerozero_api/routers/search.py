"""Unified search router — one endpoint, two result buckets.

Contract: ``docs/PHASE3_CONTRACTS.md`` → Search section.

  - ``GET /search?q=&lat=&lng=&type=`` → :class:`SearchResults`

The handler is thin: it validates that ``q`` is at least 2 characters
(FastAPI emits 422 otherwise via ``Query(min_length=2)``), forwards
everything else to :mod:`zerozero_api.services.search_service`, and
returns whatever the service builds.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.schemas.search import SearchResults
from zerozero_api.services import search_service

__all__ = ["router"]


router = APIRouter(prefix="/search", tags=["search"])


@router.get(
    "",
    response_model=SearchResults,
    summary="Unified search",
    description=(
        "Fuzzy search across active restaurants and available menu items. "
        "Ranks by Postgres trigram similarity with an ILIKE substring fallback. "
        "When `lat`/`lng` are supplied, restaurant hits are further filtered "
        "by delivery radius (ST_DWithin). Min query length is 2."
    ),
    responses={422: {"description": "Query too short (`q` must be >= 2 chars)."}},
)
async def search_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[
        str,
        Query(
            min_length=2,
            max_length=100,
            description="Free-text query. Minimum 2 characters.",
        ),
    ],
    lat: Annotated[
        float | None,
        Query(ge=-90, le=90, description="Caller latitude (WGS84)."),
    ] = None,
    lng: Annotated[
        float | None,
        Query(ge=-180, le=180, description="Caller longitude (WGS84)."),
    ] = None,
    type_filter: Annotated[
        Literal["all", "restaurant", "menu_item"],
        Query(
            alias="type",
            description="Restrict to a single bucket; 'all' returns both (default).",
        ),
    ] = "all",
) -> SearchResults:
    """Return unified restaurant + menu-item search results."""
    return await search_service.unified_search(
        db,
        q=q,
        lat=lat,
        lng=lng,
        type_filter=type_filter,
    )

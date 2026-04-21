"""Public cuisines router — list all cuisines for filter rails.

Simple read-only endpoint. Results are cached in-process for 60 seconds
because the list is tiny, changes rarely, and is hit on every homepage
render.
"""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.domain.cuisine import Cuisine
from zerozero_api.schemas.cuisine import CuisineOut

__all__ = ["router"]


router = APIRouter(prefix="/cuisines", tags=["restaurants"])


# ---------------------------------------------------------------------------
# Tiny in-process cache
# ---------------------------------------------------------------------------
#
# Cuisines rarely change; refetching them on every home load wastes a
# round-trip. A 60-second TTL keeps the data effectively real-time while
# collapsing the common case to zero DB calls per worker.
_CACHE_TTL_SECONDS = 60.0
_cache: dict[str, tuple[float, list[CuisineOut]]] = {}


def _read_cache(key: str) -> list[CuisineOut] | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if expires_at < time.monotonic():
        _cache.pop(key, None)
        return None
    return value


def _write_cache(key: str, value: list[CuisineOut]) -> None:
    _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, value)


@router.get(
    "",
    response_model=list[CuisineOut],
    summary="List cuisines",
    description="Return every cuisine, ordered by name. Cached for 60s per worker.",
)
async def list_cuisines_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[CuisineOut]:
    """Return all cuisines ordered by name."""
    cached = _read_cache("all")
    if cached is not None:
        return cached

    stmt = select(Cuisine).order_by(Cuisine.name.asc())
    result = await db.execute(stmt)
    rows = result.scalars().all()
    out = [CuisineOut.model_validate(row) for row in rows]
    _write_cache("all", out)
    return out

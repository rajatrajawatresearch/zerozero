"""Public categories router — list all menu categories for homepage rails.

Read-only endpoint. Results are cached in-process for 60 seconds since
categories are small and barely change.
"""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.domain.category import Category
from zerozero_api.schemas.category import CategoryOut

__all__ = ["router"]


router = APIRouter(prefix="/categories", tags=["restaurants"])


# ---------------------------------------------------------------------------
# Tiny in-process cache (same pattern as cuisines router).
# ---------------------------------------------------------------------------
_CACHE_TTL_SECONDS = 60.0
_cache: dict[str, tuple[float, list[CategoryOut]]] = {}


def _read_cache(key: str) -> list[CategoryOut] | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if expires_at < time.monotonic():
        _cache.pop(key, None)
        return None
    return value


def _write_cache(key: str, value: list[CategoryOut]) -> None:
    _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, value)


@router.get(
    "",
    response_model=list[CategoryOut],
    summary="List menu categories",
    description=(
        "Return every menu category, ordered by `sort_order` asc then name. "
        "Cached for 60s per worker."
    ),
)
async def list_categories_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[CategoryOut]:
    """Return all categories ordered by sort_order, then name."""
    cached = _read_cache("all")
    if cached is not None:
        return cached

    stmt = select(Category).order_by(Category.sort_order.asc(), Category.name.asc())
    result = await db.execute(stmt)
    rows = result.scalars().all()
    out = [CategoryOut.model_validate(row) for row in rows]
    _write_cache("all", out)
    return out

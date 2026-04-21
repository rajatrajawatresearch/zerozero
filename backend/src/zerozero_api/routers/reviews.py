"""Reviews router — public list + admin aggregate recompute (Phase 4).

This router is **purely additive** on top of Phase 3. The existing
``POST /orders/{id}/review`` endpoint lives in :mod:`routers.orders` and
is not touched here; we only expose:

  - ``GET  /reviews/restaurants/{slug}``  — public, paginated reviews
    for the restaurant-detail page (joins user name + avatar).
  - ``POST /reviews/admin/recompute``     — admin-only sweep that
    refreshes ``restaurants.rating_avg`` / ``rating_count`` either for
    a single restaurant (``?restaurant_id=...``) or for every
    restaurant that has at least one review.

The admin sweep covers the Phase-4 aggregate-sync requirement without
editing Phase-3 ``order_service.create_review``; see
:mod:`services.review_service` for the full tradeoff rationale.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.deps import require_role
from zerozero_api.domain.enums import UserRole
from zerozero_api.domain.user import User
from zerozero_api.schemas.common import PageOut
from zerozero_api.schemas.review import ReviewListItem
from zerozero_api.services import review_service

__all__ = ["router"]


router = APIRouter(prefix="/reviews", tags=["reviews"])


# ---------------------------------------------------------------------------
# Public: paginated reviews for a restaurant
# ---------------------------------------------------------------------------


@router.get(
    "/restaurants/{slug}",
    response_model=PageOut[ReviewListItem],
    summary="List reviews for a restaurant",
    description=(
        "Public paginated list of reviews for the given restaurant slug. "
        "Each row includes the reviewer's display name and avatar so the "
        "frontend can render the list without a secondary user lookup. "
        "Newest reviews first; ``page_size`` is capped at 50."
    ),
    responses={404: {"description": "Restaurant slug not found or inactive."}},
)
async def list_restaurant_reviews_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    slug: Annotated[str, Path(description="Restaurant slug.", max_length=200)],
    page: Annotated[int, Query(ge=1, description="1-indexed page number.")] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=50, description="Page size (max 50).")
    ] = 20,
) -> PageOut[ReviewListItem]:
    """Return a page of reviews for the restaurant (public)."""
    return await review_service.list_restaurant_reviews(
        db,
        restaurant_slug=slug,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------------------------------
# Admin: recompute rating aggregates
# ---------------------------------------------------------------------------


class _RecomputeOut(dict):  # pragma: no cover - tiny helper
    """Marker-only; the endpoint returns a plain dict serialized by FastAPI."""


@router.post(
    "/admin/recompute",
    status_code=status.HTTP_200_OK,
    summary="Recompute restaurant rating aggregates (admin)",
    description=(
        "Refresh ``restaurants.rating_avg`` and ``restaurants.rating_count`` "
        "from the current ``reviews`` table. When ``restaurant_id`` is "
        "supplied only that one restaurant is touched; otherwise every "
        "restaurant that has at least one review is swept. Idempotent and "
        "cheap — safe to schedule as a cron. This is the Phase-4 aggregate "
        "sync path (Phase-3's review-create endpoint is intentionally "
        "unchanged; see services.review_service for the rationale)."
    ),
)
async def recompute_aggregates_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, Depends(require_role(UserRole.ADMIN))],
    restaurant_id: Annotated[
        UUID | None,
        Query(description="When set, only recompute this restaurant."),
    ] = None,
) -> dict[str, object]:
    """Recompute one or all restaurant rating aggregates."""
    if restaurant_id is not None:
        avg, count = await review_service.recompute_restaurant_rating(
            db, restaurant_id
        )
        return {
            "updated": 1,
            "restaurant_id": str(restaurant_id),
            "rating_avg": str(avg),
            "rating_count": count,
        }

    updated = await review_service.recompute_all_restaurant_ratings(db)
    return {"updated": updated}

"""Orders router — checkout, history, detail, cancel, review, public track.

Handlers are intentionally thin: they parse / validate query + path
params, then delegate to :mod:`services.order_service`. Auth is required
on everything except ``GET /orders/{id}/track``, which also accepts an
unauthenticated lookup via ``?share_token=...``.

Routes (mounted under ``{API_V1_PREFIX}``):

  - ``POST /orders``                 → :class:`OrderDetailOut` (checkout)
  - ``GET  /orders``                 → :class:`PageOut[OrderListItem]`
  - ``GET  /orders/{id}``            → :class:`OrderDetailOut`
  - ``POST /orders/{id}/cancel``     → :class:`OrderDetailOut`
  - ``POST /orders/{id}/review``     → :class:`ReviewOut`
  - ``GET  /orders/{id}/track``      → :class:`OrderTrackOut`
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.deps import get_current_user, get_optional_user
from zerozero_api.domain.user import User
from zerozero_api.schemas.common import PageOut
from zerozero_api.schemas.order import (
    CheckoutIn,
    OrderDetailOut,
    OrderListItem,
    OrderTrackOut,
)
from zerozero_api.schemas.review import ReviewCreateIn, ReviewOut
from zerozero_api.services import order_service

__all__ = ["router"]


router = APIRouter(prefix="/orders", tags=["orders"])


# ---------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=OrderDetailOut,
    status_code=status.HTTP_201_CREATED,
    summary="Place an order (checkout)",
    description=(
        "Materialize the caller's server-side cart into a new order in a "
        "single transaction. The cart is cleared on success. The returned "
        "payload includes the full price breakdown, the snapshotted items, "
        "and the initial status event so the frontend can render the "
        "order-detail page immediately."
    ),
    responses={
        409: {"description": "Cart is empty or contains multiple restaurants."},
        404: {"description": "Address not found or not owned by caller."},
    },
)
async def checkout_endpoint(
    payload: CheckoutIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> OrderDetailOut:
    """Create an order from the caller's cart."""
    return await order_service.checkout(db, user, payload)


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=PageOut[OrderListItem],
    summary="List the caller's orders",
    description=(
        "Paginated history of the caller's orders, newest first. Use "
        "``status=active|past|delivered|cancelled`` to scope the list for "
        "the tab UIs."
    ),
)
async def list_orders_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    status_filter: Annotated[
        Literal[
            "all",
            "active",
            "past",
            "placed",
            "confirmed",
            "preparing",
            "ready",
            "out_for_delivery",
            "delivered",
            "cancelled",
            "failed",
        ]
        | None,
        Query(alias="status", description="Grouping alias or raw order status."),
    ] = None,
    page: Annotated[int, Query(ge=1, description="1-indexed page number.")] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=50, description="Page size (max 50).")
    ] = 20,
) -> PageOut[OrderListItem]:
    """Return a page of order tiles for the caller."""
    return await order_service.list_orders(
        db,
        user,
        status_filter=status_filter,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------


@router.get(
    "/{order_id}",
    response_model=OrderDetailOut,
    summary="Get order detail",
    description="Return the full order with items, address, price breakdown, and status events.",
    responses={404: {"description": "Order not found or not owned by caller."}},
)
async def get_order_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    order_id: Annotated[UUID, Path(description="Order UUID.")],
) -> OrderDetailOut:
    """Return one :class:`OrderDetailOut` or raise 404."""
    return await order_service.get_order(db, user, order_id)


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------


@router.post(
    "/{order_id}/cancel",
    response_model=OrderDetailOut,
    summary="Cancel an order",
    description=(
        "Cancel an order that is still in ``placed`` or ``confirmed`` status. "
        "Any later state returns a 409. A new ``cancelled`` event is appended "
        "to the order's status history."
    ),
    responses={
        404: {"description": "Order not found or not owned by caller."},
        409: {"description": "Order is past the cancellable states."},
    },
)
async def cancel_order_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    order_id: Annotated[UUID, Path(description="Order UUID.")],
) -> OrderDetailOut:
    """Cancel an order; returns the post-cancel detail."""
    return await order_service.cancel_order(db, user, order_id)


# ---------------------------------------------------------------------------
# Review
# ---------------------------------------------------------------------------


@router.post(
    "/{order_id}/review",
    response_model=ReviewOut,
    status_code=status.HTTP_201_CREATED,
    summary="Review a delivered order",
    description=(
        "Attach a 1-5 star rating + optional comment to a delivered order. "
        "Only one review per order is allowed."
    ),
    responses={
        404: {"description": "Order not found or not owned by caller."},
        409: {"description": "Order has not been delivered yet."},
        422: {"description": "A review already exists for this order."},
    },
)
async def create_review_endpoint(
    payload: ReviewCreateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    order_id: Annotated[UUID, Path(description="Order UUID.")],
) -> ReviewOut:
    """Create a review for the order and return it."""
    review = await order_service.create_review(db, user, order_id, payload)
    return ReviewOut.model_validate(review)


# ---------------------------------------------------------------------------
# Track (dual-mode auth: logged-in OR share_token)
# ---------------------------------------------------------------------------


@router.get(
    "/{order_id}/track",
    response_model=OrderTrackOut,
    summary="Poll order status",
    description=(
        "Lightweight polling endpoint for the order-tracking page. Authenticated "
        "callers can track any of their orders; anonymous callers must supply "
        "the ``share_token`` query param (from the order-detail response). "
        "Phase 4 will replace this with a WebSocket channel; until then the "
        "frontend polls every ~10s."
    ),
    responses={
        404: {"description": "Order not found or share_token invalid."},
    },
)
async def track_order_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User | None, Depends(get_optional_user)],
    order_id: Annotated[UUID, Path(description="Order UUID.")],
    share_token: Annotated[
        str | None,
        Query(
            max_length=64,
            description=(
                "Public share token. Required for anonymous callers; ignored "
                "when the request is authenticated as the order's owner."
            ),
        ),
    ] = None,
) -> OrderTrackOut:
    """Return the current status + event log (optionally partner coords)."""
    # Logged-in ownership check wins when both are supplied; otherwise we
    # fall back to the share_token path. This matches the contract
    # "accepts either auth or share_token".
    if user is not None and share_token is None:
        return await order_service.get_track(db, order_id=order_id, user=user)
    return await order_service.get_track(
        db, order_id=order_id, share_token=share_token, user=user
    )

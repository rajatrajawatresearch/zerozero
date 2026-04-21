"""Delivery-partner REST routes (Phase 4).

Per the contract in ``docs/PHASE4_CONTRACTS.md``:

    POST /partner/online                     — mark online + current location
    POST /partner/location                   — batch of GPS pings
    POST /partner/orders/{id}/accept         — claim an assigned order
    POST /partner/orders/{id}/status         — advance order status

All routes gate on ``Depends(require_role(UserRole.PARTNER, UserRole.ADMIN))``
so customer tokens can't drive the partner simulator. ``ADMIN`` is
allowed for ops-side overrides.

Handlers stay thin — validation + delegation to
:mod:`services.partner_service`.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.deps import require_role
from zerozero_api.domain.order import Order
from zerozero_api.domain.partner import DeliveryPartner
from zerozero_api.domain.user import User, UserRole
from zerozero_api.schemas.order import OrderDetailOut
from zerozero_api.schemas.partner import (
    PartnerAcceptOrderOut,
    PartnerLocationBatchIn,
    PartnerOnlineIn,
    PartnerStatusUpdateIn,
)
from zerozero_api.services import order_service, partner_service

__all__ = ["router"]


router = APIRouter(
    prefix="/partner",
    tags=["partner"],
    dependencies=[Depends(require_role(UserRole.PARTNER, UserRole.ADMIN))],
)


# ---------------------------------------------------------------------------
# Online
# ---------------------------------------------------------------------------


@router.post(
    "/online",
    status_code=status.HTTP_200_OK,
    summary="Go online with current coordinates",
    description=(
        "Flip ``is_online=True`` and stamp the partner's current location. "
        "Creates the :class:`DeliveryPartner` profile row on first call if "
        "the user hasn't been onboarded yet."
    ),
)
async def go_online_endpoint(
    payload: PartnerOnlineIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[
        User, Depends(require_role(UserRole.PARTNER, UserRole.ADMIN))
    ],
) -> dict[str, object]:
    """Return a minimal ack with the partner id + online flag."""
    partner: DeliveryPartner = await partner_service.go_online(db, user, payload)
    return {"partner_id": str(partner.id), "is_online": partner.is_online}


# ---------------------------------------------------------------------------
# Location batch
# ---------------------------------------------------------------------------


@router.post(
    "/location",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Push a batch of GPS pings",
    description=(
        "Append 1–100 GPS points to the partner's location stream. The "
        "newest point updates ``delivery_partners.location`` and is "
        "broadcast to the ``partners:{id}`` WS channel. If the partner "
        "has an in-flight order, the point is also mirrored to the "
        "``orders:{order_id}`` and ``public:{share_token}`` channels."
    ),
    responses={
        404: {"description": "Partner profile not found — call /partner/online first."},
    },
)
async def push_location_endpoint(
    payload: PartnerLocationBatchIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[
        User, Depends(require_role(UserRole.PARTNER, UserRole.ADMIN))
    ],
) -> dict[str, int]:
    """Return the number of points persisted."""
    inserted = await partner_service.push_locations(db, user, payload)
    return {"inserted": inserted}


# ---------------------------------------------------------------------------
# Accept order
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/accept",
    response_model=PartnerAcceptOrderOut,
    status_code=status.HTTP_200_OK,
    summary="Accept an assigned order",
    description=(
        "Claim the order for this partner and transition it from "
        "``placed`` to ``confirmed`` (no-op if already past confirmed). "
        "Returns the pickup and drop coordinates the partner app needs "
        "to render the route overlay."
    ),
    responses={
        404: {"description": "Order not found."},
        409: {"description": "Order is already assigned or in a terminal state."},
    },
)
async def accept_order_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[
        User, Depends(require_role(UserRole.PARTNER, UserRole.ADMIN))
    ],
    order_id: Annotated[UUID, Path(description="Order UUID.")],
) -> PartnerAcceptOrderOut:
    """Claim the order and return its pickup/drop coordinates."""
    return await partner_service.accept_order(db, user, order_id)


# ---------------------------------------------------------------------------
# Update status
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/status",
    response_model=OrderDetailOut,
    status_code=status.HTTP_200_OK,
    summary="Advance an order's status",
    description=(
        "Forward-transition the order's status "
        "(confirmed → preparing → ready → out_for_delivery → delivered). "
        "Appends an :class:`OrderStatusEvent` and broadcasts on "
        "``orders:{id}``, ``partners:{partner_id}``, and "
        "``public:{share_token}``."
    ),
    responses={
        403: {"description": "Order is not assigned to this partner."},
        404: {"description": "Order not found."},
        409: {"description": "Invalid state transition for current order status."},
    },
)
async def update_status_endpoint(
    payload: PartnerStatusUpdateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[
        User, Depends(require_role(UserRole.PARTNER, UserRole.ADMIN))
    ],
    order_id: Annotated[UUID, Path(description="Order UUID.")],
) -> OrderDetailOut:
    """Advance status and return the refreshed order detail.

    Note: ``order_service.get_order`` gates on ``user_id == caller.id``
    which fails for partner callers (they aren't the order's customer),
    so we build the detail payload via a partner-scoped helper that
    bypasses that check while reusing the same projection logic.
    """
    updated: Order = await partner_service.update_status(db, user, order_id, payload)
    return await _build_partner_order_detail(db, updated)


# ---------------------------------------------------------------------------
# Detail helper (partner-scoped)
# ---------------------------------------------------------------------------


async def _build_partner_order_detail(
    db: AsyncSession, order: Order
) -> OrderDetailOut:
    """Load + project an :class:`OrderDetailOut` without customer-ownership gating.

    ``order_service.get_order`` enforces ``user_id == caller.id`` which
    fails for partner callers. We reproduce the detail assembly here
    using the private helpers that drive the customer path.
    """
    # Reuse the order_service internals for consistency — these are stable
    # helpers used by checkout, cancel, and detail endpoints.
    reloaded = await order_service._load_order_detail(db, order_id=order.id)  # type: ignore[attr-defined]
    restaurant = reloaded.restaurant
    address_out = await order_service._hydrate_address_out(db, reloaded.address)  # type: ignore[attr-defined]
    return order_service._build_detail(  # type: ignore[attr-defined]
        reloaded,
        address_out=address_out,
        restaurant_name=restaurant.name if restaurant else "",
        restaurant_image=(restaurant.cover_url or restaurant.image_url)
        if restaurant
        else None,
    )

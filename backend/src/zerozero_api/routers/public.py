"""Public (share-token) tracking router — Phase 4.

Endpoint exposed here:

  - ``GET /public/track/{share_token}`` → :class:`PublicTrackOut`

No auth is required — the opaque ``share_token`` IS the authority. To
discourage token enumeration we throttle the endpoint per-IP via slowapi.
The same sanitization rules used for the WebSocket initial snapshot live
in :mod:`services.public_service`, so both entry points stay in lock-step.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.ratelimit import limiter
from zerozero_api.schemas.public import PublicTrackOut
from zerozero_api.services import public_service

__all__ = ["router"]


router = APIRouter(prefix="/public", tags=["public"])


@router.get(
    "/track/{share_token}",
    response_model=PublicTrackOut,
    summary="Public order tracking by share token",
    description=(
        "Unauthenticated tracking view for a shared order link. The returned "
        "payload strips all PII: no customer name, no street line1/line2, "
        "and only the destination city plus a truncated label are echoed. "
        "Rate-limited to 60 requests/minute/IP to prevent token enumeration."
    ),
    responses={
        404: {"description": "No order matches this share token."},
        429: {"description": "Rate limit exceeded."},
    },
)
@limiter.limit("60/minute")
async def public_track_endpoint(
    request: Request,  # noqa: ARG001 — required by slowapi to key the bucket
    share_token: Annotated[
        str,
        Path(
            min_length=8,
            max_length=64,
            description="Opaque share token from the order-detail response.",
        ),
    ],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PublicTrackOut:
    """Return a sanitized :class:`PublicTrackOut` for the given token."""
    return await public_service.get_track_by_token(db, share_token)

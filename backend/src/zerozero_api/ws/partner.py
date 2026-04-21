"""Partner-side WebSocket endpoint (Phase 4).

    /ws/partner?token=<access>

Flow:
  1. Pull ``?token=`` from the URL and decode via
     :func:`zerozero_api.ws.auth.ws_get_user_from_token`. Bad / missing
     token → close with 4401.
  2. Enforce ``role in {partner, admin}`` — else 4403.
  3. Upsert-load the :class:`DeliveryPartner` profile; missing → 4404.
  4. Join the ``partners:{partner_id}`` channel via the shared
     :class:`ConnectionManager`.
  5. Relay inbound client JSON (``ping``, optional ``location`` events)
     and let the manager's Redis pub/sub fan-out deliver any
     ``assignment`` / ``status`` / ``partner_location`` messages the
     REST layer publishes.
  6. On disconnect, leave the channel cleanly.

The heartbeat schedule (server ping every 25 s, drop if no pong within
10 s) is owned by Agent 1's :class:`ConnectionManager`; we don't
re-implement it here.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from zerozero_api.core.db import async_session_factory
from zerozero_api.core.logging import get_logger
from zerozero_api.domain.enums import UserRole
from zerozero_api.domain.partner import DeliveryPartner
from zerozero_api.ws.auth import (
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_NOT_FOUND,
    WS_CLOSE_UNAUTHORIZED,
    ws_get_user_from_token,
)

__all__ = ["router"]


_logger = get_logger(__name__)


router = APIRouter(tags=["ws"])


def _partner_channel(partner_id: UUID) -> str:
    """Canonical channel name for a partner's personal stream."""
    return f"partners:{partner_id}"


@router.websocket("/ws/partner")
async def partner_ws(
    websocket: WebSocket,
    token: str | None = Query(
        default=None,
        description="Access token (same JWT used for HTTP auth).",
    ),
) -> None:
    """Authenticate, join ``partners:{id}``, relay messages.

    Client messages we currently accept:
      - ``{"type": "pong"}`` — heartbeat reply (consumed by the manager).
      - ``{"type": "ping"}`` — echoed back via the manager's handling
        (client-initiated heartbeats are also fine).

    All outbound events (``assignment``, ``status``, ``partner_location``)
    arrive via the Redis → :class:`ConnectionManager` fan-out.
    """
    # Agent 1 contract — imported inline to keep module-load order
    # resilient to the parallel-agent merge sequence.
    from zerozero_api.ws.connection_manager import manager

    await websocket.accept()

    # 1) Auth
    async with async_session_factory() as session:
        user = await ws_get_user_from_token(websocket, token, session)
        if user is None:
            await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason="invalid_token")
            return

        # 2) Role guard — WS routes can't use Depends(require_role),
        # so we replicate the check manually.
        if user.role not in {UserRole.PARTNER, UserRole.ADMIN}:
            await websocket.close(
                code=WS_CLOSE_FORBIDDEN, reason="partner_role_required"
            )
            return

        # 3) Resolve the partner profile. Admins can impersonate any
        # partner via ``?partner_id=`` — but for Phase 4 we keep the
        # simple single-profile case and 4404 if the admin doesn't have
        # a DeliveryPartner row of their own.
        stmt = select(DeliveryPartner).where(DeliveryPartner.user_id == user.id)
        partner = (await session.execute(stmt)).scalar_one_or_none()

    if partner is None:
        await websocket.close(
            code=WS_CLOSE_NOT_FOUND, reason="partner_profile_missing"
        )
        return

    channel = _partner_channel(partner.id)
    await manager.join(channel, websocket)
    _logger.info("ws.partner.connect", partner_id=str(partner.id), channel=channel)

    try:
        # The connection manager's heartbeat loop does the ping/pong
        # bookkeeping; this receive loop exists purely to (a) keep the
        # socket alive and (b) drain inbound pongs so Starlette doesn't
        # buffer forever. We ignore payload content — any future partner-
        # initiated events (e.g. device-side status reports) would be
        # dispatched here.
        while True:
            message = await websocket.receive_text()
            # Best-effort log at debug level; the manager handles pong
            # liveness tracking on its own side.
            _logger.debug(
                "ws.partner.recv",
                partner_id=str(partner.id),
                size=len(message),
            )
    except WebSocketDisconnect:
        _logger.info("ws.partner.disconnect", partner_id=str(partner.id))
    except Exception:
        _logger.error(
            "ws.partner.error", partner_id=str(partner.id), exc_info=True
        )
    finally:
        await manager.leave(channel, websocket)

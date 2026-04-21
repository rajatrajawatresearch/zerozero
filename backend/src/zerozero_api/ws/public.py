"""Public share-token WebSocket endpoint — Phase 4.

Route: ``/ws/public/track/{share_token}``

No ``?token=`` auth. The opaque ``share_token`` minted at checkout is the
only authority. Lifecycle:

  1. Validate the token resolves to a real order.
  2. Refuse sockets for orders already in a terminal state
     (``delivered`` / ``cancelled`` / ``failed``) with close code 4403 —
     there's nothing live to push.
  3. Join the Redis-backed ``public:{share_token}`` channel via the shared
     :class:`ConnectionManager` (owned by Agent 1).
  4. Send an initial, PII-stripped snapshot so the UI renders instantly
     instead of waiting for the next status tick.
  5. Keep the socket open and echo ``pong`` on ``ping`` frames. All
     outbound traffic (status / partner_location / eta) is published by
     the order / partner services into the same Redis channel and fanned
     out by Agent 1's subscriber task.

Contract: ``docs/PHASE4_CONTRACTS.md`` — "public:{share_token}" section.
"""

from __future__ import annotations

import contextlib
import json
from typing import Final

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from zerozero_api.core.db import async_session_factory
from zerozero_api.core.errors import NotFoundError
from zerozero_api.core.logging import get_logger
from zerozero_api.domain.enums import OrderStatus
from zerozero_api.services import public_service
from zerozero_api.ws.auth import WS_CLOSE_FORBIDDEN, WS_CLOSE_NOT_FOUND
from zerozero_api.ws.connection_manager import manager
from zerozero_api.ws.events import dump

__all__ = ["router"]


_logger = get_logger(__name__)

router = APIRouter(tags=["ws"])


# Orders in these states are done; the public link has nothing live to show.
_TERMINAL_STATES: Final[frozenset[OrderStatus]] = frozenset(
    {OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.FAILED}
)


def _channel_for(share_token: str) -> str:
    """Redis pub/sub channel for a public tracker."""
    return f"public:{share_token}"


@router.websocket("/ws/public/track/{share_token}")
async def public_track_socket(ws: WebSocket, share_token: str) -> None:
    """Stream sanitized order updates to an anonymous visitor.

    The share_token is not validated as cryptographically authenticating
    the viewer — it's a capability URL. Anyone with the link can watch.
    We still refuse terminal orders so clients don't hold idle sockets.
    """
    # 1) Basic shape check — the router only accepts 8..64 chars for HTTP,
    #    but the WS path is unconstrained so we enforce the same bound here.
    if not share_token or not (8 <= len(share_token) <= 64):
        await ws.close(code=WS_CLOSE_NOT_FOUND, reason="invalid share token")
        return

    # 2) Resolve the order + build the initial snapshot inside one session
    #    so the connection isn't kept open against the pool beyond the read.
    try:
        async with async_session_factory() as session:
            try:
                order = await public_service.load_order_by_token(
                    session, share_token
                )
            except NotFoundError:
                await ws.close(
                    code=WS_CLOSE_NOT_FOUND, reason="share token not found"
                )
                return

            if order.status in _TERMINAL_STATES:
                await ws.accept()
                # Send one last snapshot so the UI can render the final
                # state, then close. This mirrors the HTTP 200 behaviour
                # and spares the frontend a separate fetch after the
                # "done" flag.
                snapshot = public_service.build_public_track(order)
                await ws.send_text(snapshot.model_dump_json())
                await ws.close(
                    code=WS_CLOSE_FORBIDDEN, reason="order no longer active"
                )
                return

            snapshot_json = public_service.build_public_track(order).model_dump_json()
    except Exception:  # pragma: no cover — defensive: never leak 500s to WS
        _logger.exception("ws.public.resolve_failed", share_token=share_token)
        if ws.client_state == WebSocketState.CONNECTING:
            await ws.close(code=1011, reason="internal error")
        return

    # 3) Accept + join the Redis-backed channel.
    await ws.accept()
    channel = _channel_for(share_token)
    await manager.join(channel, ws)

    try:
        # 4) Initial snapshot so the UI paints before the next broadcast.
        await ws.send_text(snapshot_json)

        # 5) Message loop — we only react to ping/pong from this side;
        #    everything else flows in through the ConnectionManager's
        #    Redis subscriber task which calls `broadcast(channel, ...)`.
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(msg, dict) and msg.get("type") == "ping":
                await ws.send_text(dump({"type": "pong"}))
    except WebSocketDisconnect:
        # Normal client-side close — nothing to log beyond debug.
        _logger.debug("ws.public.disconnect", share_token=share_token)
    except Exception:  # pragma: no cover
        _logger.exception("ws.public.loop_failed", share_token=share_token)
    finally:
        with contextlib.suppress(Exception):
            await manager.leave(channel, ws)
        if ws.client_state != WebSocketState.DISCONNECTED:
            with contextlib.suppress(Exception):
                await ws.close()

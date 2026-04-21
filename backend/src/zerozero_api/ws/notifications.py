"""``/ws/notifications`` — authed user live notification feed.

Lifecycle:
  1. Accept the socket.
  2. Resolve ``?token=`` → user (close 4401 on failure).
  3. Register in ``manager`` under channel ``notifications:{user_id}``.
  4. Concurrently run:
       * read loop — responds to client ``ping`` with ``pong``
       * keepalive — server ``ping`` every 25s per Phase 4 contract
  5. On disconnect, deregister.

Frames pushed out come from :func:`services.notification_service.create`,
which both inserts the row and fans out via Redis + local broadcast.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from zerozero_api.core.db import async_session_factory
from zerozero_api.core.logging import get_logger
from zerozero_api.services.notification_service import channel_for_user
from zerozero_api.ws.auth import WS_CLOSE_UNAUTHORIZED, ws_get_user_from_token
from zerozero_api.ws.connection_manager import manager

__all__ = ["router"]

_logger = get_logger(__name__)

router = APIRouter(tags=["ws"])

# Server-initiated ping cadence per Phase 4 contract.
_KEEPALIVE_SECONDS: float = 25.0


@router.websocket("/ws/notifications")
async def ws_notifications(ws: WebSocket) -> None:
    """Accept a WS, auth via ``?token=``, join the user's notification channel."""
    await ws.accept()

    token = ws.query_params.get("token")

    # 1. Auth — resolve the token against a short-lived session.
    async with async_session_factory() as session:
        user = await ws_get_user_from_token(ws, token, session)
        if user is None:
            await ws.close(code=WS_CLOSE_UNAUTHORIZED, reason="unauthorized")
            return
        user_id = user.id

    channel = channel_for_user(user_id)
    await manager.join(channel, ws)

    # 2. Send a welcome frame so the client can confirm the socket is live
    #    (and gracefully reset its retry backoff).
    await _safe_send_json(ws, {"type": "connected"})

    try:
        # 3. Concurrent read loop (handles ping/pong) + server keepalive.
        read_task = asyncio.create_task(_read_loop(ws))
        ping_task = asyncio.create_task(_keepalive_loop(ws))
        done, pending = await asyncio.wait(
            {read_task, ping_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for t in pending:
            t.cancel()
        for t in done:
            exc = t.exception()
            if exc and not isinstance(
                exc, (WebSocketDisconnect, asyncio.CancelledError)
            ):
                _logger.warning("ws.notifications.task_error", error=str(exc))
    finally:
        await manager.leave(channel, ws)
        if ws.client_state == WebSocketState.CONNECTED:
            try:
                await ws.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Internal helpers (mirrors ws/orders.py shape)
# ---------------------------------------------------------------------------


async def _read_loop(ws: WebSocket) -> None:
    """Process inbound frames — we only recognise ping / pong."""
    while True:
        raw = await ws.receive_text()
        try:
            msg: Any = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(msg, dict):
            continue
        mtype = msg.get("type")
        if mtype == "ping":
            await _safe_send_json(ws, {"type": "pong"})
        elif mtype == "pong":
            # Client acked our keepalive — nothing to do.
            continue


async def _keepalive_loop(ws: WebSocket) -> None:
    """Send a server ``ping`` every ``_KEEPALIVE_SECONDS``."""
    while True:
        await asyncio.sleep(_KEEPALIVE_SECONDS)
        if ws.client_state != WebSocketState.CONNECTED:
            return
        await _safe_send_json(ws, {"type": "ping"})


async def _safe_send_json(ws: WebSocket, payload: dict[str, Any]) -> None:
    """``send_text`` with a JSON body; swallow disconnect errors."""
    if ws.client_state != WebSocketState.CONNECTED:
        return
    try:
        await ws.send_text(json.dumps(payload, separators=(",", ":")))
    except Exception:
        return

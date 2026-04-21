"""``/ws/orders/{order_id}`` — authenticated customer live order feed.

Lifecycle:
  1. Accept the socket.
  2. Resolve ``?token=`` → user (close 4401 on failure).
  3. Load order by id; must belong to the caller (close 4404 / 4403).
  4. Register in ``manager`` under channel ``orders:{order_id}``.
  5. Send an initial snapshot (current status + last known partner location
     if the order is out-for-delivery).
  6. Concurrently:
       * read loop — handles inbound ``ping`` / ``pong``
       * keepalive — server sends ``ping`` every 25s
  7. On disconnect, deregister.

Real-time events themselves arrive asynchronously via the Redis subscriber
running inside ``ConnectionManager`` — this handler never broadcasts directly.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import desc, select
from sqlalchemy.orm import selectinload
from starlette.websockets import WebSocketState

from zerozero_api.core.db import async_session_factory
from zerozero_api.core.logging import get_logger
from zerozero_api.domain.enums import OrderStatus
from zerozero_api.domain.order import Order
from zerozero_api.domain.partner import PartnerLocation
from zerozero_api.ws.auth import (
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_NOT_FOUND,
    WS_CLOSE_UNAUTHORIZED,
    ws_get_user_from_token,
)
from zerozero_api.ws.connection_manager import manager

__all__ = ["router", "start_manager", "stop_manager"]

_logger = get_logger(__name__)

router = APIRouter(tags=["ws"])

# Server-initiated ping cadence per Phase 4 contract.
_KEEPALIVE_SECONDS: float = 25.0


# ---------------------------------------------------------------------------
# Lifespan hooks re-exported for main.py
# ---------------------------------------------------------------------------


async def start_manager() -> None:
    """Entry point for app startup — spins up the Redis subscriber."""
    await manager.start_redis_subscriber()


async def stop_manager() -> None:
    """Entry point for app shutdown — cancels subscriber, closes Redis."""
    await manager.stop()


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.websocket("/ws/orders/{order_id}")
async def ws_orders(ws: WebSocket, order_id: UUID) -> None:
    await ws.accept()

    token = ws.query_params.get("token")

    # 1. Auth
    async with async_session_factory() as session:
        user = await ws_get_user_from_token(ws, token, session)
        if user is None:
            await ws.close(code=WS_CLOSE_UNAUTHORIZED, reason="unauthorized")
            return

        # 2. Load order + verify ownership
        result = await session.execute(
            select(Order)
            .where(Order.id == order_id)
            .options(selectinload(Order.partner))
        )
        order = result.scalar_one_or_none()
        if order is None:
            await ws.close(code=WS_CLOSE_NOT_FOUND, reason="order not found")
            return
        if order.user_id != user.id and user.role.value != "admin":
            await ws.close(code=WS_CLOSE_FORBIDDEN, reason="forbidden")
            return

        # 3. Snapshot data to send before we drop the session
        snapshot_status = order.status
        snapshot_share = order.share_token
        partner_id = order.partner_id
        last_loc_row = None
        if (
            partner_id is not None
            and snapshot_status == OrderStatus.OUT_FOR_DELIVERY
        ):
            loc_result = await session.execute(
                select(PartnerLocation)
                .where(PartnerLocation.partner_id == partner_id)
                .order_by(desc(PartnerLocation.recorded_at))
                .limit(1)
            )
            last_loc_row = loc_result.scalar_one_or_none()

    channel = f"orders:{order_id}"
    await manager.join(channel, ws)

    try:
        # 4. Initial snapshot: status first, then partner location (if any)
        now_iso = datetime.now(UTC).isoformat()
        await _safe_send_json(
            ws,
            {
                "type": "status",
                "status": snapshot_status.value,
                "at": now_iso,
            },
        )
        if last_loc_row is not None:
            lat, lng = _extract_lat_lng(last_loc_row.location)
            if lat is not None and lng is not None:
                await _safe_send_json(
                    ws,
                    {
                        "type": "partner_location",
                        "lat": lat,
                        "lng": lng,
                        "heading": last_loc_row.heading,
                        "speed": last_loc_row.speed_kmh,
                        "at": (
                            last_loc_row.recorded_at.isoformat()
                            if last_loc_row.recorded_at
                            else now_iso
                        ),
                    },
                )

        # 5. Concurrent read-loop + keepalive
        read_task = asyncio.create_task(_read_loop(ws))
        ping_task = asyncio.create_task(_keepalive_loop(ws))
        done, pending = await asyncio.wait(
            {read_task, ping_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for t in pending:
            t.cancel()
        # Surface disconnects cleanly
        for t in done:
            exc = t.exception()
            if exc and not isinstance(exc, (WebSocketDisconnect, asyncio.CancelledError)):
                _logger.warning("ws.orders.task_error", error=str(exc))

    finally:
        await manager.leave(channel, ws)
        # share_token kept in scope if we ever want to dual-publish to public channel.
        _ = snapshot_share
        if ws.client_state == WebSocketState.CONNECTED:
            try:
                await ws.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _read_loop(ws: WebSocket) -> None:
    """Process inbound frames. Currently only recognises ping / pong."""
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
            # Client acked our keepalive — nothing to do, just loop.
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
        # Caller's outer loop will detect the disconnect on next receive.
        return


def _extract_lat_lng(geom: Any) -> tuple[float | None, float | None]:
    """Best-effort lat/lng extraction from a WKB/WKT-ish geometry object.

    We avoid a DB round-trip for ``ST_X`` / ``ST_Y`` by parsing what Shapely
    or geoalchemy2 hands us. If parsing fails we emit ``(None, None)`` and
    the caller will simply skip the location snapshot.
    """
    if geom is None:
        return None, None
    try:
        # Shapely path (preferred — available whenever geoalchemy2 is).
        from geoalchemy2.shape import to_shape

        shape = to_shape(geom)
        return float(shape.y), float(shape.x)
    except Exception:
        pass
    # Fall back to attribute probe for already-decoded points.
    lat = getattr(geom, "y", None) or getattr(geom, "lat", None)
    lng = getattr(geom, "x", None) or getattr(geom, "lng", None)
    if lat is None or lng is None:
        return None, None
    try:
        return float(lat), float(lng)
    except (TypeError, ValueError):
        return None, None

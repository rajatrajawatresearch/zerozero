"""In-process WebSocket connection registry + Redis pub/sub fan-out.

One ``ConnectionManager`` singleton per worker owns:
  * a ``channel → set[WebSocket]`` map of live connections
  * a single background task that ``PSUBSCRIBE``s to every ``orders:*``,
    ``partners:*``, and ``public:*`` Redis key and fans each incoming
    message out to the matching channel's local sockets.

Any backend code that wants to push a real-time event MUST go through
``zerozero_api.services.event_bus`` — which publishes to Redis — instead of
calling ``manager.broadcast`` directly. That keeps the pipeline single-source
even when we have more than one API worker.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketState

from zerozero_api.core.logging import get_logger
from zerozero_api.services.event_bus import close_redis, get_redis

__all__ = ["ConnectionManager", "manager"]

_logger = get_logger(__name__)

# Redis PSUBSCRIBE patterns that cover every WS channel we care about.
_PATTERNS: tuple[str, ...] = ("orders:*", "partners:*", "public:*")


class ConnectionManager:
    """Thread-safe (asyncio-lock) map of channel → sockets + Redis subscriber."""

    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = {}
        self._lock: asyncio.Lock = asyncio.Lock()
        self._subscriber_task: asyncio.Task[None] | None = None
        self._stopping: bool = False

    # ------------------------------------------------------------------
    # Membership
    # ------------------------------------------------------------------
    async def join(self, channel: str, ws: WebSocket) -> None:
        """Add ``ws`` to ``channel``. Socket must already be ``accept``-ed."""
        async with self._lock:
            self.connections.setdefault(channel, set()).add(ws)

    async def leave(self, channel: str, ws: WebSocket) -> None:
        """Remove ``ws`` from ``channel``. Silently no-ops if absent."""
        async with self._lock:
            bucket = self.connections.get(channel)
            if bucket is None:
                return
            bucket.discard(ws)
            if not bucket:
                # Prune empty buckets so the dict doesn't grow unbounded.
                self.connections.pop(channel, None)

    # ------------------------------------------------------------------
    # Fan-out
    # ------------------------------------------------------------------
    async def broadcast(self, channel: str, msg: dict[str, Any] | str) -> None:
        """Send ``msg`` to every socket subscribed to ``channel``.

        Dead sockets (send failures) are silently dropped from the registry —
        clients that crashed or closed without a goodbye frame shouldn't keep
        us sending into the void.
        """
        # Snapshot under lock so iteration doesn't race with join/leave.
        async with self._lock:
            bucket = self.connections.get(channel)
            sockets: list[WebSocket] = list(bucket) if bucket else []

        if not sockets:
            return

        payload: str = msg if isinstance(msg, str) else json.dumps(msg, separators=(",", ":"))

        stale: list[WebSocket] = []
        for ws in sockets:
            if ws.client_state != WebSocketState.CONNECTED:
                stale.append(ws)
                continue
            try:
                await ws.send_text(payload)
            except Exception:
                stale.append(ws)

        if stale:
            async with self._lock:
                bucket = self.connections.get(channel)
                if bucket is not None:
                    for ws in stale:
                        bucket.discard(ws)
                    if not bucket:
                        self.connections.pop(channel, None)

    # ------------------------------------------------------------------
    # Redis subscriber lifecycle
    # ------------------------------------------------------------------
    async def start_redis_subscriber(self) -> None:
        """Kick off the background task that pipes Redis pub/sub → broadcast."""
        if self._subscriber_task is not None and not self._subscriber_task.done():
            return
        self._stopping = False
        self._subscriber_task = asyncio.create_task(
            self._run_subscriber(), name="ws-redis-subscriber"
        )

    async def _run_subscriber(self) -> None:
        """Long-running loop: PSUBSCRIBE → broadcast. Reconnects on failure."""
        while not self._stopping:
            pubsub = None
            try:
                redis = get_redis()
                pubsub = redis.pubsub()
                await pubsub.psubscribe(*_PATTERNS)
                _logger.info("ws.redis.subscribed", patterns=list(_PATTERNS))

                async for event in pubsub.listen():
                    if self._stopping:
                        break
                    # ``psubscribe``'s first event is a confirmation, not data.
                    if event.get("type") != "pmessage":
                        continue
                    channel = event.get("channel")
                    data = event.get("data")
                    if not isinstance(channel, str) or not isinstance(data, str):
                        continue
                    # We pass the raw JSON string through untouched — no need
                    # to decode+re-encode since it's already valid JSON.
                    await self.broadcast(channel, data)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                _logger.warning("ws.redis.subscriber_error", error=str(exc))
                # Brief backoff before reconnecting so we don't hot-loop when
                # Redis is down.
                await asyncio.sleep(1.0)
            finally:
                if pubsub is not None:
                    try:
                        await pubsub.punsubscribe(*_PATTERNS)
                        await pubsub.aclose()
                    except Exception:
                        pass

    async def stop(self) -> None:
        """Cancel the subscriber task, close the Redis client."""
        self._stopping = True
        task = self._subscriber_task
        self._subscriber_task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        await close_redis()


# Process-wide singleton — imported by endpoint handlers and lifespan hooks.
manager: ConnectionManager = ConnectionManager()

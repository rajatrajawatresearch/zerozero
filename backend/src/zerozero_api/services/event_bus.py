"""Redis pub/sub event bus — thin wrapper other agents import to emit events.

All real-time WS fan-out flows through Redis so we can scale WS workers
horizontally without pinning subscribers to a specific process. This module
exposes three publishers matching the channel scheme from
``docs/PHASE4_CONTRACTS.md``:

  - ``orders:{order_id}``    — fan out to all watchers of a given order
  - ``partners:{partner_id}`` — fan out to a specific partner's socket
  - ``public:{share_token}``  — fan out to the public tracking link

Redis client is lazy-initialized from ``settings.REDIS_URL`` and cached.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from redis.asyncio import Redis, from_url

from zerozero_api.settings import get_settings

__all__ = [
    "channel_for_order",
    "channel_for_partner",
    "channel_for_public",
    "close_redis",
    "get_redis",
    "publish_order_event",
    "publish_partner_event",
    "publish_public_event",
]


_redis: Redis | None = None


def get_redis() -> Redis:
    """Return a process-wide cached async Redis client.

    ``decode_responses=True`` so pub/sub messages come back as ``str``
    instead of ``bytes`` — simpler downstream JSON parsing.
    """
    global _redis
    if _redis is None:
        settings = get_settings()
        _redis = from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def close_redis() -> None:
    """Close the cached Redis client (called on app shutdown)."""
    global _redis
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = None


def channel_for_order(order_id: UUID | str) -> str:
    return f"orders:{order_id}"


def channel_for_partner(partner_id: UUID | str) -> str:
    return f"partners:{partner_id}"


def channel_for_public(share_token: str) -> str:
    return f"public:{share_token}"


def _encode(msg: dict[str, Any]) -> str:
    """Compact JSON, with UUID/datetime fallback so callers don't have to pre-stringify."""
    from datetime import datetime

    def _default(obj: Any) -> Any:
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, UUID):
            return str(obj)
        raise TypeError(f"unserializable: {type(obj).__name__}")

    return json.dumps(msg, separators=(",", ":"), default=_default)


async def publish_order_event(order_id: UUID, msg: dict[str, Any]) -> None:
    """Publish an event on the ``orders:{order_id}`` channel."""
    await get_redis().publish(channel_for_order(order_id), _encode(msg))


async def publish_partner_event(partner_id: UUID, msg: dict[str, Any]) -> None:
    """Publish an event on the ``partners:{partner_id}`` channel."""
    await get_redis().publish(channel_for_partner(partner_id), _encode(msg))


async def publish_public_event(share_token: str, msg: dict[str, Any]) -> None:
    """Publish an event on the ``public:{share_token}`` channel."""
    await get_redis().publish(channel_for_public(share_token), _encode(msg))

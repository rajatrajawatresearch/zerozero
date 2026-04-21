"""Redis-backed read-through cache for geocoding results.

The Nominatim ToS asks us to cache aggressively (24h is typical) because
every cache hit is a request we don't send to their free tile server.

Usage::

    value_json = await get_or_set(
        key="zz:geo:search:coffee shop",
        ttl_seconds=86400,
        fetch=lambda: _call_nominatim(...),
    )

The helper is intentionally schema-agnostic — it stores raw JSON strings
so callers can round-trip any serializable payload (list, dict, etc.).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from redis.asyncio import Redis, from_url
from redis.exceptions import RedisError

from zerozero_api.core.logging import get_logger
from zerozero_api.settings import get_settings

__all__ = ["close_redis", "get_or_set", "get_redis"]


_logger = get_logger("zerozero_api.geo.cache")

# Module-level lazy singleton. We don't use the lifespan event here to
# avoid coupling geo with the app boot order — first call wins.
_redis_client: Redis | None = None


def get_redis() -> Redis:
    """Return the module-level Redis client, creating it on first use.

    ``decode_responses=True`` gives us ``str`` values back (JSON text)
    instead of raw bytes — simpler for downstream ``json.loads``.
    """
    global _redis_client
    if _redis_client is None:
        settings = get_settings()
        _redis_client = from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2.0,
            socket_timeout=2.0,
        )
    return _redis_client


async def close_redis() -> None:
    """Dispose the module-level Redis client. Used by tests."""
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
        except Exception:
            pass
        _redis_client = None


async def get_or_set(
    key: str,
    ttl_seconds: int,
    fetch: Callable[[], Awaitable[str]],
) -> str:
    """Return the cached JSON string at ``key`` or call ``fetch`` and store it.

    Args:
        key: Redis key (caller is responsible for namespacing).
        ttl_seconds: Expiry for the value. 24h (86400) is the geo default.
        fetch: Async factory that produces the JSON string on cache miss.

    Returns:
        The JSON-encoded payload as a ``str``. Caller is responsible for
        ``json.loads`` — we store and return raw strings so the same helper
        works for lists, dicts, or null.

    Behavior:
        - Redis read errors are logged and treated as a miss (we still
          call ``fetch`` and attempt to write).
        - Write errors are logged and swallowed — a cache write failure
          should never break the request path.
    """
    client = get_redis()

    try:
        cached = await client.get(key)
        if cached is not None:
            _logger.debug("geo.cache.hit", key=key)
            return cached  # type: ignore[no-any-return]
    except RedisError as exc:
        _logger.warning("geo.cache.read_failed", key=key, error=str(exc))

    value = await fetch()

    try:
        await client.set(key, value, ex=ttl_seconds)
    except RedisError as exc:
        _logger.warning(
            "geo.cache.write_failed", key=key, ttl=ttl_seconds, error=str(exc)
        )

    return value

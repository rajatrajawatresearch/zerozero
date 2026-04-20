from __future__ import annotations

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from zerozero_api.settings import get_settings

__all__ = [
    "RateLimitExceeded",
    "limiter",
    "login_limit",
    "public_limit",
]


_settings = get_settings()


# Redis-backed limiter so counters survive worker restarts and are shared
# across uvicorn workers / replicas. `key_func=get_remote_address` keys on
# the client IP (respecting X-Forwarded-For when the proxy middleware is
# installed upstream). Individual routes can override via their own keys.
limiter: Limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=_settings.REDIS_URL,
    strategy="fixed-window",
)


# Canonical rate-limit strings consumed via `@limiter.limit(login_limit)`.
# Keeping these as module constants means routers don't hardcode magic
# strings and tuning is one place.
login_limit: str = "5/minute"
public_limit: str = "60/minute"

"""Health and liveness endpoints.

Implements the `zerozero_api.routers.health` contract from
`docs/AGENT_CONTRACTS.md`.

Exposes two endpoints under the ``system`` tag:

  - ``GET /health``   — lenient health summary. Always returns 200 so simple
                        load-balancer probes don't flap; the body reports
                        ``status: "ok"|"degraded"`` along with per-dependency
                        booleans.
  - ``GET /healthz``  — strict readiness check. Returns 200 iff the DB is
                        reachable, otherwise 503 (Kubernetes-style).
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel
from redis.asyncio import Redis, from_url
from redis.exceptions import RedisError

from zerozero_api import __version__
from zerozero_api.core.db import ping_db
from zerozero_api.core.logging import get_logger
from zerozero_api.settings import get_settings

__all__ = ["router"]


router = APIRouter(tags=["system"])
_logger = get_logger("zerozero_api.health")

# Timeout for a single redis PING (seconds). Keep this small — the health
# endpoint shouldn't block a dashboard refresh on a hung network path.
_REDIS_PING_TIMEOUT_S = 1.0


ServiceStatus = Literal["ok", "down"]
OverallStatus = Literal["ok", "degraded"]


class HealthResponse(BaseModel):
    status: OverallStatus
    db: ServiceStatus
    redis: ServiceStatus
    version: str


class HealthzResponse(BaseModel):
    status: Literal["ok", "unhealthy"]
    db: ServiceStatus
    version: str


async def _ping_redis() -> bool:
    """Return ``True`` if Redis replies to ``PING`` inside the timeout."""
    settings = get_settings()
    client: Redis | None = None
    try:
        client = from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=_REDIS_PING_TIMEOUT_S,
            socket_timeout=_REDIS_PING_TIMEOUT_S,
        )
        await asyncio.wait_for(client.ping(), timeout=_REDIS_PING_TIMEOUT_S)
        return True
    except (RedisError, asyncio.TimeoutError, OSError):
        return False
    except Exception:
        # Defensive: never let a health probe raise.
        return False
    finally:
        if client is not None:
            try:
                await client.aclose()
            except Exception:
                pass


@router.get(
    "/health",
    summary="Lenient health summary",
    response_model=HealthResponse,
)
async def health() -> HealthResponse:
    """Report overall service and dependency health.

    Always returns HTTP 200 so naive probes (ELB default checks, uptime
    monitors) pass while the body carries the real state. Use ``/healthz``
    when you need a hard DB-gated readiness signal.
    """
    db_ok, redis_ok = await asyncio.gather(ping_db(), _ping_redis())
    status: OverallStatus = "ok" if (db_ok and redis_ok) else "degraded"
    return HealthResponse(
        status=status,
        db="ok" if db_ok else "down",
        redis="ok" if redis_ok else "down",
        version=__version__,
    )


@router.get(
    "/healthz",
    summary="Strict readiness probe (503 if DB down)",
    response_model=HealthzResponse,
)
async def healthz() -> ORJSONResponse:
    """Return 200 only when the database is reachable; else 503."""
    db_ok = await ping_db()
    if db_ok:
        return ORJSONResponse(
            content=HealthzResponse(
                status="ok", db="ok", version=__version__
            ).model_dump()
        )
    return ORJSONResponse(
        status_code=503,
        content=HealthzResponse(
            status="unhealthy", db="down", version=__version__
        ).model_dump(),
    )

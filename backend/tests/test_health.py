"""Integration tests for the health endpoints.

Contract (see ``docs/AGENT_CONTRACTS.md`` -> ``zerozero_api.routers.health``):
  - ``GET /api/v1/health``  -> 200 JSON ``{status, db, redis, version}``
  - ``GET /api/v1/healthz`` -> 200 when both db + redis are up (strict probe)

The fixtures in ``tests/conftest.py`` boot real Postgres + Redis containers,
so these are genuine integration tests (not mocks).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_returns_ok(client: AsyncClient) -> None:
    """The loose ``/health`` probe should respond 200 with a known status."""
    response = await client.get("/api/v1/health")

    assert response.status_code == 200, (
        f"/api/v1/health returned {response.status_code}: {response.text}"
    )

    body = response.json()
    # ``status`` is a required top-level field per the contract.
    assert "status" in body, f"response missing `status` field: {body!r}"
    assert body["status"] in {"ok", "degraded"}, (
        f"unexpected status {body['status']!r}; expected one of ok|degraded"
    )
    # ``db`` must always be present — tests include real Postgres, so it should be up.
    assert "db" in body, f"response missing `db` field: {body!r}"


@pytest.mark.asyncio
async def test_healthz_strict(client: AsyncClient) -> None:
    """The strict ``/healthz`` probe should 200 when both db + redis are up.

    We don't enforce the exact body shape — just that the endpoint exists and
    returns a success code when the containerized infra is healthy.
    """
    response = await client.get("/api/v1/healthz")

    # Some agents may ship /healthz under root instead of versioned prefix;
    # accept both but the versioned path is the primary contract.
    if response.status_code == 404:
        response = await client.get("/healthz")

    assert response.status_code == 200, (
        f"strict healthz probe returned {response.status_code}: {response.text}"
    )

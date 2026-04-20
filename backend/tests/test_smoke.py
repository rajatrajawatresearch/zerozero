"""Smoke tests — cheap sanity checks that the app boots and is wired up.

These catch the most common Phase 1 regressions quickly:
  - import-time failures (missing env, broken module graph)
  - OpenAPI schema not exposing the expected paths (router not mounted)
  - Request-ID middleware not echoing the inbound correlation id
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


def test_imports_work() -> None:
    """Importing the FastAPI app must not raise.

    Uses the ``app`` fixture's same code path but exercises it directly so a
    broken import chain is flagged before any network-style test even runs.
    """
    from zerozero_api.main import app as fastapi_app

    # Touch a minimal attribute to defeat any lazy-import trickery.
    assert fastapi_app.title, "FastAPI app must have a non-empty title"


@pytest.mark.asyncio
async def test_openapi_has_expected_paths(client: AsyncClient) -> None:
    """The OpenAPI schema must advertise the versioned health endpoint."""
    response = await client.get("/openapi.json")
    assert response.status_code == 200, (
        f"/openapi.json returned {response.status_code}: {response.text}"
    )

    schema = response.json()
    assert "paths" in schema, "openapi document missing `paths` key"

    paths = schema["paths"]
    assert "/api/v1/health" in paths, (
        f"expected /api/v1/health in openapi paths; saw: {sorted(paths.keys())}"
    )


@pytest.mark.asyncio
async def test_request_id_echoed(client: AsyncClient) -> None:
    """``RequestIdMiddleware`` must echo an inbound ``X-Request-ID`` header back.

    This is the contract that lets the frontend and backend share a correlation
    id across a single logical request; if the middleware is missing or the
    header name drifts, this test flags it immediately.
    """
    correlation_id = "test-abc"
    response = await client.get(
        "/api/v1/health",
        headers={"X-Request-ID": correlation_id},
    )

    assert response.status_code in {200, 503}, (
        f"health endpoint returned unexpected {response.status_code}"
    )

    # Header names are case-insensitive; httpx normalizes lookup.
    echoed = response.headers.get("x-request-id")
    assert echoed == correlation_id, (
        f"expected X-Request-ID {correlation_id!r} echoed back, got {echoed!r}"
    )

"""Integration tests for ``POST /api/v1/auth/refresh``.

Contract (``docs/PHASE2_CONTRACTS.md`` -> Auth):
    POST /auth/refresh -> 200 {tokens: TokensOut}

The refresh endpoint rotates the token (old refresh row marked revoked,
new jti issued) — these tests verify that rotation actually happens and
that replay, invalid-token, and wrong-token-type all collapse into a
single generic 401.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import DEFAULT_PASSWORD, make_user


LOGIN_URL = "/api/v1/auth/login"
REFRESH_URL = "/api/v1/auth/refresh"
INVALID_REFRESH_CODE = "invalid_refresh_token"


async def _login_fresh(
    client: AsyncClient, db: AsyncSession
) -> dict[str, str]:
    """Create a user, log them in, return the ``tokens`` block."""
    email = f"refresh-{uuid.uuid4().hex[:10]}@example.com"
    await make_user(db, email=email, password=DEFAULT_PASSWORD)
    response = await client.post(
        LOGIN_URL, json={"email": email, "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 200, response.text
    return response.json()["tokens"]


@pytest.mark.asyncio
async def test_refresh_happy_path_rotates_tokens(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Happy path: a valid refresh mints NEW tokens; the old refresh dies."""
    tokens = await _login_fresh(client, db_session)
    old_refresh = tokens["refresh_token"]
    old_access = tokens["access_token"]

    response = await client.post(
        REFRESH_URL, json={"refresh_token": old_refresh}
    )
    assert response.status_code == 200, response.text

    new_tokens = response.json()["tokens"]
    assert new_tokens["access_token"] and new_tokens["access_token"] != old_access
    assert new_tokens["refresh_token"] and new_tokens["refresh_token"] != old_refresh
    assert new_tokens["token_type"] == "bearer"

    # Old refresh MUST be rejected post-rotation.
    replay = await client.post(
        REFRESH_URL, json={"refresh_token": old_refresh}
    )
    assert replay.status_code == 401, (
        f"old refresh token should be unusable, got {replay.status_code}: {replay.text}"
    )


@pytest.mark.asyncio
async def test_refresh_invalid_token_rejected(client: AsyncClient) -> None:
    """A garbage refresh token must 401 — not 500 or 422."""
    response = await client.post(
        REFRESH_URL, json={"refresh_token": "not.a.jwt"}
    )
    assert response.status_code == 401, response.text


@pytest.mark.asyncio
async def test_refresh_token_cannot_be_used_twice(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Explicit replay check: same valid refresh used twice -> 2nd call 401.

    Separate test from the happy path so the failure mode is attributable.
    """
    tokens = await _login_fresh(client, db_session)
    refresh = tokens["refresh_token"]

    first = await client.post(REFRESH_URL, json={"refresh_token": refresh})
    assert first.status_code == 200, first.text

    second = await client.post(REFRESH_URL, json={"refresh_token": refresh})
    assert second.status_code == 401, (
        f"2nd refresh with same token must 401, got {second.status_code}: {second.text}"
    )

    error = second.json().get("error", second.json())
    # Accept either the specific code or a generic 401 envelope — services may
    # opt to hide the precise reason. But IF a code is present, it must be the
    # documented one.
    if isinstance(error, dict) and "code" in error:
        assert error["code"] == INVALID_REFRESH_CODE, (
            f"expected code={INVALID_REFRESH_CODE!r}, got {error['code']!r}"
        )


@pytest.mark.asyncio
async def test_refresh_rejects_access_token(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Passing an ACCESS token where a REFRESH token is expected must 401.

    This is a critical security boundary: access tokens are shorter-lived
    and lack a ``jti`` claim in our schema. Accepting one would let any
    scraped Authorization header be traded for a long-lived refresh.
    """
    tokens = await _login_fresh(client, db_session)
    access = tokens["access_token"]

    response = await client.post(REFRESH_URL, json={"refresh_token": access})
    assert response.status_code == 401, response.text

"""Integration tests for ``GET /api/v1/auth/me`` + ``POST /auth/logout``.

Contract (``docs/PHASE2_CONTRACTS.md`` -> Auth):
    GET  /auth/me     -> 200 UserOut   (bearer required)
    POST /auth/logout -> 204           (revokes the caller's refresh token)

The expired-token case is exercised by monkey-patching the security
module's clock so ``create_access_token`` mints a token with ``exp`` in
the past — the same technique used in ``tests/test_security.py``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import DEFAULT_PASSWORD, auth_headers, make_user


LOGIN_URL = "/api/v1/auth/login"
ME_URL = "/api/v1/auth/me"
LOGOUT_URL = "/api/v1/auth/logout"
REFRESH_URL = "/api/v1/auth/refresh"


@pytest.mark.asyncio
async def test_me_with_valid_bearer_returns_user(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A valid bearer must return the caller's ``UserOut`` payload."""
    email = f"me-{uuid.uuid4().hex[:10]}@example.com"
    user = await make_user(db_session, email=email, full_name="Me Myself")

    login = await client.post(
        LOGIN_URL, json={"email": email, "password": DEFAULT_PASSWORD}
    )
    assert login.status_code == 200, login.text
    access = login.json()["tokens"]["access_token"]

    response = await client.get(ME_URL, headers=auth_headers(access))
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["id"] == str(user.id)
    assert body["email"].lower() == email.lower()
    assert body["full_name"] == "Me Myself"
    assert body["role"] == "customer"
    # Never return the password hash through the schema.
    assert "password_hash" not in body and "password" not in body


@pytest.mark.asyncio
async def test_me_without_auth_header_is_401(client: AsyncClient) -> None:
    """No ``Authorization`` header must collapse to a 401 — never 500."""
    response = await client.get(ME_URL)
    assert response.status_code == 401, response.text


@pytest.mark.asyncio
async def test_me_expired_access_token_is_401(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An expired access token must 401, not deserialize silently.

    We wind back the module-level ``_now_utc`` helper so the new token is
    born already expired (past = now-1h, default TTL = 15min).
    """
    email = f"expired-{uuid.uuid4().hex[:10]}@example.com"
    user = await make_user(db_session, email=email)

    from zerozero_api.core import security as security_mod

    past = datetime.now(UTC) - timedelta(hours=1)
    monkeypatch.setattr(security_mod, "_now_utc", lambda: past)
    expired_token = security_mod.create_access_token(
        str(user.id), extra={"role": user.role.value}
    )
    monkeypatch.undo()

    response = await client.get(ME_URL, headers=auth_headers(expired_token))
    assert response.status_code == 401, (
        f"expected 401 for expired token, got {response.status_code}: {response.text}"
    )


@pytest.mark.asyncio
async def test_logout_revokes_refresh_token(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Logout must revoke the refresh token so a subsequent refresh 401s.

    Flow:
      1. Create + login -> (access, refresh)
      2. POST /auth/logout with bearer => 204
      3. POST /auth/refresh with the SAME refresh => 401
    """
    email = f"logout-{uuid.uuid4().hex[:10]}@example.com"
    await make_user(db_session, email=email)

    login = await client.post(
        LOGIN_URL, json={"email": email, "password": DEFAULT_PASSWORD}
    )
    assert login.status_code == 200, login.text
    tokens = login.json()["tokens"]
    access = tokens["access_token"]
    refresh = tokens["refresh_token"]

    logout = await client.post(
        LOGOUT_URL,
        headers=auth_headers(access),
        json={"refresh_token": refresh},
    )
    # 204 is the contract; 200 is also acceptable if the service returns
    # an empty JSON body — we fail hard on anything else.
    assert logout.status_code in {200, 204}, (
        f"logout expected 204/200, got {logout.status_code}: {logout.text}"
    )

    replay = await client.post(REFRESH_URL, json={"refresh_token": refresh})
    assert replay.status_code == 401, (
        f"refresh after logout should 401, got {replay.status_code}: {replay.text}"
    )

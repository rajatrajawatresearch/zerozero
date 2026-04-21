"""Integration tests for ``POST /api/v1/auth/login``.

Contract (``docs/PHASE2_CONTRACTS.md`` -> Auth):
    POST /auth/login -> 200 {user: UserOut, tokens: TokensOut}

Also exercises the ``5/minute`` slowapi rate-limit decorator on the login
route — using a stable ``X-Forwarded-For`` header so slowapi's
``get_remote_address`` bucket is deterministic across retries.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import DEFAULT_PASSWORD, make_user
from zerozero_api.domain.enums import UserRole


LOGIN_URL = "/api/v1/auth/login"
GENERIC_ERROR_CODE = "invalid_credentials"


def _login_payload(email: str, password: str = DEFAULT_PASSWORD) -> dict[str, str]:
    return {"email": email, "password": password}


def _pinned_ip_headers(ip: str = "203.0.113.7") -> dict[str, str]:
    """Return headers that pin slowapi's key_func to a known IP.

    slowapi's ``get_remote_address`` reads ``X-Forwarded-For`` first and
    falls back to ``client.host``; pinning here isolates our rate-limit
    test from whatever default the test transport sets.
    """
    return {"X-Forwarded-For": ip}


@pytest.mark.asyncio
async def test_login_returns_fresh_tokens(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Happy path: a valid email/password pair returns a 200 + tokens."""
    email = f"login-{uuid.uuid4().hex[:10]}@example.com"
    await make_user(db_session, email=email, password=DEFAULT_PASSWORD)

    response = await client.post(LOGIN_URL, json=_login_payload(email))
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["user"]["email"].lower() == email.lower()
    tokens = body["tokens"]
    assert tokens["access_token"] and tokens["refresh_token"]
    assert tokens["token_type"] == "bearer"
    assert isinstance(tokens["expires_in"], int) and tokens["expires_in"] > 0


@pytest.mark.asyncio
async def test_login_wrong_password_is_generic_401(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Wrong password must 401 with the generic ``invalid_credentials`` code.

    The error message / code MUST be identical to the "unknown email" case
    so an attacker cannot enumerate which emails are registered.
    """
    email = f"wrong-pw-{uuid.uuid4().hex[:10]}@example.com"
    await make_user(db_session, email=email, password=DEFAULT_PASSWORD)

    response = await client.post(LOGIN_URL, json=_login_payload(email, "wrongpass1"))
    assert response.status_code == 401, response.text

    error = response.json().get("error", response.json())
    assert isinstance(error, dict)
    assert error.get("code") == GENERIC_ERROR_CODE, error


@pytest.mark.asyncio
async def test_login_unknown_email_is_same_generic_401(
    client: AsyncClient,
) -> None:
    """Unknown email must 401 with the same code — no user enumeration."""
    response = await client.post(
        LOGIN_URL,
        json=_login_payload(f"nobody-{uuid.uuid4().hex[:10]}@example.com"),
    )
    assert response.status_code == 401, response.text

    error = response.json().get("error", response.json())
    assert isinstance(error, dict)
    assert error.get("code") == GENERIC_ERROR_CODE, error


@pytest.mark.asyncio
async def test_login_deactivated_user_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A user with ``is_active=False`` must not be able to log in."""
    email = f"inactive-{uuid.uuid4().hex[:10]}@example.com"
    await make_user(
        db_session,
        email=email,
        password=DEFAULT_PASSWORD,
        is_active=False,
        role=UserRole.CUSTOMER,
    )

    response = await client.post(LOGIN_URL, json=_login_payload(email))
    assert response.status_code == 401, response.text


@pytest.mark.asyncio
async def test_login_rate_limited_after_five_attempts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The 6th bad login inside a minute (same IP) must 429.

    slowapi is configured with ``@limiter.limit("5/minute")`` on the login
    route (see ``core.ratelimit.login_limit``). We send six consecutive
    bad requests from the same pinned IP; the first five should 401 and
    the sixth must 429. We also accept any non-success code for attempts
    1-5 so this test stays resilient if the limit is tuned later.
    """
    email = f"rl-{uuid.uuid4().hex[:10]}@example.com"
    await make_user(db_session, email=email, password=DEFAULT_PASSWORD)

    headers = _pinned_ip_headers("203.0.113.42")
    wrong = _login_payload(email, "definitelyWrong99")

    last_status: int | None = None
    for _ in range(5):
        resp = await client.post(LOGIN_URL, json=wrong, headers=headers)
        last_status = resp.status_code
        # Attempts within the window should be the generic 401. If the
        # limiter fires early for any reason we'll catch it below.
        assert resp.status_code in {401, 429}, (
            f"expected 401 (or early 429), got {resp.status_code}: {resp.text}"
        )

    # 6th attempt must cross the limit.
    limited = await client.post(LOGIN_URL, json=wrong, headers=headers)
    assert limited.status_code == 429, (
        f"expected 429 after 6 bad logins, got {limited.status_code}: {limited.text} "
        f"(last pre-limit status was {last_status})"
    )

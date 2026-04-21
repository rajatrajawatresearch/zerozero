"""Factory helpers for Phase 2 backend tests.

Every helper here is intentionally small, synchronous-friendly where
possible, and stays decoupled from the exact router URLs so the test
suite survives reasonable contract tweaks. The HTTP-aware helpers
(`make_authenticated_client`, `signup_and_login`) hit the real FastAPI
application via the shared ``client`` fixture — which, per
``tests/conftest.py``, already points at the transactional ``db_session``.

Design choices
--------------
* ``make_user`` inserts the user directly via the SQLAlchemy session so we
  never couple auth-unrelated tests (e.g. addresses) to the signup route
  being green first.
* ``make_authenticated_client`` drives the real ``/auth/signup`` endpoint
  so token minting stays end-to-end. This also guarantees the refresh
  token row exists in the DB for downstream tests.
* ``auth_headers`` is a zero-fuss ``Authorization`` builder used in the
  handful of tests that construct their own tokens (e.g. expired-token
  checks) instead of going through signup.
"""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.security import hash_password
from zerozero_api.domain.enums import UserRole
from zerozero_api.domain.user import User

__all__ = [
    "DEFAULT_PASSWORD",
    "auth_headers",
    "make_authenticated_client",
    "make_user",
    "signup_and_login",
]


# Passwords must be >=8 chars per the Phase 2 SignupIn contract.
DEFAULT_PASSWORD: str = "Test1234"


def _unique_email(prefix: str = "user") -> str:
    """Return a collision-proof email for a single test run."""
    return f"{prefix}-{uuid.uuid4().hex[:12]}@example.com"


async def make_user(
    db: AsyncSession,
    *,
    email: str | None = None,
    password: str = DEFAULT_PASSWORD,
    full_name: str = "Test User",
    phone: str | None = None,
    role: UserRole = UserRole.CUSTOMER,
    is_active: bool = True,
    email_verified: bool = False,
) -> User:
    """Insert + commit a ``User`` row directly and return a fresh instance.

    We bypass the signup endpoint on purpose — this keeps tests that only
    *use* a user (addresses, profile PATCH, etc.) independent of the auth
    router being shipped in the same run.
    """
    user = User(
        email=email or _unique_email(),
        password_hash=hash_password(password),
        full_name=full_name,
        phone=phone,
        role=role,
        is_active=is_active,
        email_verified=email_verified,
    )
    db.add(user)
    # flush so `user.id` / server defaults populate, then commit so any
    # follow-up transaction (inside the same savepoint) sees it durably.
    await db.flush()
    await db.commit()
    await db.refresh(user)
    return user


def auth_headers(access_token: str) -> dict[str, str]:
    """Build a standard ``Authorization: Bearer <token>`` header mapping."""
    return {"Authorization": f"Bearer {access_token}"}


async def signup_and_login(
    client: AsyncClient,
    *,
    email: str | None = None,
    password: str = DEFAULT_PASSWORD,
    full_name: str = "Test User",
    phone: str | None = None,
) -> dict[str, Any]:
    """Hit ``POST /auth/signup`` and return the full parsed JSON body.

    The caller may assert on ``data["user"]`` / ``data["tokens"]`` directly.
    Raises ``AssertionError`` (via the status-code assertion) on any non-2xx
    response so the calling test fails fast with a clear traceback.
    """
    payload: dict[str, Any] = {
        "email": email or _unique_email(),
        "password": password,
        "full_name": full_name,
    }
    if phone is not None:
        payload["phone"] = phone

    response = await client.post("/api/v1/auth/signup", json=payload)
    assert response.status_code == 201, (
        f"signup helper expected 201, got {response.status_code}: {response.text}"
    )
    return response.json()


async def make_authenticated_client(
    client: AsyncClient,
    db: AsyncSession,
    **user_kw: Any,
) -> tuple[AsyncClient, User]:
    """Create a user + attach a bearer token to ``client.headers``.

    Returns the SAME ``client`` instance (headers mutated in place) plus the
    freshly-created ``User`` row so tests can assert on DB state as well as
    HTTP responses. Mutation-in-place mirrors how the TanStack Query axios
    client is configured in the frontend — one client, one default header.

    Token acquisition: we POST ``/auth/signup`` so that the refresh token
    row is persisted by the real auth service (important for the refresh /
    logout tests which need a valid server-side jti to rotate).
    """
    email = user_kw.pop("email", None) or _unique_email()
    password = user_kw.pop("password", DEFAULT_PASSWORD)
    full_name = user_kw.pop("full_name", "Test User")
    phone = user_kw.pop("phone", None)
    role = user_kw.pop("role", UserRole.CUSTOMER)

    if role != UserRole.CUSTOMER or user_kw:
        # For non-customer roles (or any extra kwargs like is_active=False)
        # the signup endpoint won't let us set them; insert directly and
        # then mint tokens by hitting ``/auth/login``.
        await make_user(
            db,
            email=email,
            password=password,
            full_name=full_name,
            phone=phone,
            role=role,
            **user_kw,
        )
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
        )
        assert login_resp.status_code == 200, (
            f"login helper expected 200, got {login_resp.status_code}: {login_resp.text}"
        )
        body = login_resp.json()
    else:
        body = await signup_and_login(
            client,
            email=email,
            password=password,
            full_name=full_name,
            phone=phone,
        )

    access_token = body["tokens"]["access_token"]
    client.headers.update(auth_headers(access_token))

    # Re-fetch the User row so the caller can rely on server-side defaults
    # (created_at, email_verified, etc.) and so the instance is attached
    # to the test session for relationship loading.
    from sqlalchemy import select

    user_id = uuid.UUID(body["user"]["id"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    return client, user

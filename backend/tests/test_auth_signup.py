"""Integration tests for ``POST /api/v1/auth/signup``.

Contract (``docs/PHASE2_CONTRACTS.md`` -> Auth):
    POST /auth/signup -> 201 {user: UserOut, tokens: TokensOut}

Covers happy path + the validation / conflict edges that the service is
responsible for. Assertions hit both the HTTP layer *and* the DB layer so
a router that "lies" about persistence would fail clearly.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import DEFAULT_PASSWORD
from zerozero_api.domain.user import User


SIGNUP_URL = "/api/v1/auth/signup"


def _payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "email": f"signup-{uuid.uuid4().hex[:10]}@example.com",
        "password": DEFAULT_PASSWORD,
        "full_name": "Jane Doe",
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_signup_with_valid_payload_returns_user_and_tokens(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """A valid signup must:
    * respond 201
    * return a body shaped ``{user, tokens}``
    * persist the user in the database
    * never leak password / password_hash back in the response.
    """
    payload = _payload(full_name="Alice Example", phone="+911234567890")

    response = await client.post(SIGNUP_URL, json=payload)
    assert response.status_code == 201, response.text

    body = response.json()
    assert set(body.keys()) >= {"user", "tokens"}, f"unexpected keys: {body.keys()}"

    user_out = body["user"]
    tokens = body["tokens"]

    # UserOut shape (see `schemas/auth.py` contract).
    assert user_out["email"].lower() == payload["email"].lower()
    assert user_out["full_name"] == "Alice Example"
    assert user_out["phone"] == "+911234567890"
    assert user_out["role"] == "customer"
    assert user_out["email_verified"] is False
    assert "id" in user_out and uuid.UUID(user_out["id"])
    assert "created_at" in user_out

    # Secrets must NEVER appear in the response envelope.
    flat = str(body).lower()
    assert "password" not in flat, "password/password_hash leaked into response"
    assert DEFAULT_PASSWORD.lower() not in flat

    # Tokens envelope.
    assert tokens["token_type"] == "bearer"
    assert isinstance(tokens["access_token"], str) and tokens["access_token"]
    assert isinstance(tokens["refresh_token"], str) and tokens["refresh_token"]
    assert isinstance(tokens["expires_in"], int) and tokens["expires_in"] > 0

    # Persistence check — row actually landed.
    result = await db_session.execute(
        select(User).where(User.email == payload["email"])
    )
    db_user = result.scalar_one_or_none()
    assert db_user is not None, "signup did not persist the user row"
    assert db_user.password_hash and db_user.password_hash != payload["password"], (
        "password_hash must be a real hash, not plaintext"
    )
    assert db_user.password_hash.startswith("$argon2"), (
        f"expected argon2 hash, got prefix {db_user.password_hash[:10]!r}"
    )


@pytest.mark.asyncio
async def test_signup_duplicate_email_conflicts(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """A second signup with the same email must 409 with code ``email_exists``.

    The email comparison must be case-insensitive — ``CITEXT`` storage means
    ``Alice@X.com`` and ``alice@x.com`` collide.
    """
    email = f"dup-{uuid.uuid4().hex[:10]}@example.com"
    first = await client.post(SIGNUP_URL, json=_payload(email=email))
    assert first.status_code == 201, first.text

    # Mixed-case variant — CITEXT should still collide.
    dup = await client.post(SIGNUP_URL, json=_payload(email=email.upper()))
    assert dup.status_code == 409, (
        f"duplicate signup expected 409, got {dup.status_code}: {dup.text}"
    )

    body = dup.json()
    # Error envelope shape from `core.errors._envelope`.
    error = body.get("error", body)
    code = error.get("code") if isinstance(error, dict) else None
    assert code == "email_exists", f"expected code=email_exists, got {code!r} in {body!r}"


@pytest.mark.asyncio
async def test_signup_weak_password_rejected(client: AsyncClient) -> None:
    """A password shorter than 8 chars must trigger 422 validation."""
    response = await client.post(SIGNUP_URL, json=_payload(password="short7!"))
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_signup_invalid_email_rejected(client: AsyncClient) -> None:
    """Pydantic's ``EmailStr`` must reject obviously broken email strings."""
    response = await client.post(SIGNUP_URL, json=_payload(email="not-an-email"))
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_signup_missing_full_name_rejected(client: AsyncClient) -> None:
    """``full_name`` is required per the contract (min_length=2)."""
    payload = _payload()
    payload.pop("full_name")
    response = await client.post(SIGNUP_URL, json=payload)
    assert response.status_code == 422, response.text

    # Also assert that an empty / too-short name is rejected.
    short = await client.post(SIGNUP_URL, json=_payload(full_name="A"))
    assert short.status_code == 422, short.text

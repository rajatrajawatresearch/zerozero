"""Integration tests for ``PATCH /api/v1/users/me``.

Contract (``docs/PHASE2_CONTRACTS.md`` -> Users+Addresses):
    GET   /users/me   -> 200 UserOut
    PATCH /users/me   -> 200 UserOut   (partial: phone, full_name, avatar_url)

Authentication is enforced via ``Depends(get_current_user)``; the tests
verify both the happy partial-update and the unauth / empty-body edges.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import make_authenticated_client


USERS_ME_URL = "/api/v1/users/me"


@pytest.mark.asyncio
async def test_patch_users_me_updates_phone(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """PATCH /users/me with a phone field returns the updated user."""
    authed_client, user = await make_authenticated_client(client, db_session)
    original_full_name = user.full_name

    response = await authed_client.patch(
        USERS_ME_URL, json={"phone": "+919988776655"}
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["phone"] == "+919988776655"
    # Partial update: untouched fields stay the same.
    assert body["full_name"] == original_full_name
    assert body["id"] == str(user.id)


@pytest.mark.asyncio
async def test_patch_users_me_empty_body_is_noop_or_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """An empty body on PATCH must either 422 (if service rejects) or 200
    with the user unchanged (if it's treated as a no-op). Either is a
    valid contract — but NEVER a 500.
    """
    authed_client, user = await make_authenticated_client(client, db_session)

    response = await authed_client.patch(USERS_ME_URL, json={})
    assert response.status_code in {200, 422}, (
        f"empty patch should be 200 or 422, got {response.status_code}: {response.text}"
    )

    if response.status_code == 200:
        body = response.json()
        assert body["id"] == str(user.id)
        assert body["full_name"] == user.full_name
        assert body["email"].lower() == user.email.lower()


@pytest.mark.asyncio
async def test_patch_users_me_without_auth_is_401(client: AsyncClient) -> None:
    """PATCH /users/me without a bearer must 401."""
    response = await client.patch(
        USERS_ME_URL, json={"phone": "+911111111111"}
    )
    assert response.status_code == 401, response.text

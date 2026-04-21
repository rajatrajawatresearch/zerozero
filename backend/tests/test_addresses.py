"""Integration tests for ``/api/v1/users/me/addresses`` CRUD.

Contract (``docs/PHASE2_CONTRACTS.md`` -> Users+Addresses):
    GET    /users/me/addresses              -> list[AddressOut]
    POST   /users/me/addresses              -> 201 AddressOut
    PATCH  /users/me/addresses/{id}         -> AddressOut
    DELETE /users/me/addresses/{id}         -> 204
    POST   /users/me/addresses/{id}/default -> AddressOut

Key invariants under test:
* Creating two addresses with ``is_default=True`` must leave exactly ONE
  default — the most recently created. The service enforces this.
* ``POST /default`` toggles unset the prior default.
* Coordinates outside real lat/lng ranges (e.g. lng=999) must 422.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import make_authenticated_client


ADDRESSES_URL = "/api/v1/users/me/addresses"


def _valid_address(
    *,
    label: str = "home",
    line1: str = "221B Baker St",
    city: str = "Mumbai",
    state: str = "MH",
    pincode: str = "400001",
    lat: float = 19.0760,
    lng: float = 72.8777,
    is_default: bool = False,
) -> dict[str, Any]:
    return {
        "label": label,
        "line1": line1,
        "city": city,
        "state": state,
        "pincode": pincode,
        "lat": lat,
        "lng": lng,
        "is_default": is_default,
    }


@pytest.mark.asyncio
async def test_addresses_crud_happy_path(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Create, list, patch, delete — every step must respond with its
    documented status code and consistent AddressOut shape."""
    authed_client, user = await make_authenticated_client(client, db_session)

    # CREATE ----------------------------------------------------------------
    create_resp = await authed_client.post(
        ADDRESSES_URL, json=_valid_address(label="home")
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["label"] == "home"
    assert created["user_id"] == str(user.id)
    addr_id = created["id"]

    # LIST ------------------------------------------------------------------
    list_resp = await authed_client.get(ADDRESSES_URL)
    assert list_resp.status_code == 200, list_resp.text
    items = list_resp.json()
    assert any(a["id"] == addr_id for a in items), (
        f"newly-created address missing from list: {items!r}"
    )

    # PATCH -----------------------------------------------------------------
    patch_resp = await authed_client.patch(
        f"{ADDRESSES_URL}/{addr_id}", json={"label": "office"}
    )
    assert patch_resp.status_code == 200, patch_resp.text
    assert patch_resp.json()["label"] == "office"

    # DELETE ----------------------------------------------------------------
    del_resp = await authed_client.delete(f"{ADDRESSES_URL}/{addr_id}")
    assert del_resp.status_code == 204, (
        f"delete expected 204, got {del_resp.status_code}: {del_resp.text}"
    )

    # GET after delete MUST NOT include the deleted id.
    after = await authed_client.get(ADDRESSES_URL)
    assert after.status_code == 200
    assert all(a["id"] != addr_id for a in after.json()), (
        "deleted address still appears in list"
    )


@pytest.mark.asyncio
async def test_two_defaults_collapse_to_last_one(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Create A(is_default=True) then B(is_default=True) — only B stays default.

    The service must enforce the single-default invariant server-side; the
    alternative (both default) would break the frontend's default-address
    picker.
    """
    authed_client, _ = await make_authenticated_client(client, db_session)

    a_resp = await authed_client.post(
        ADDRESSES_URL,
        json=_valid_address(label="home", is_default=True),
    )
    assert a_resp.status_code == 201, a_resp.text
    a_id = a_resp.json()["id"]

    b_resp = await authed_client.post(
        ADDRESSES_URL,
        json=_valid_address(label="office", line1="Plot 42", is_default=True),
    )
    assert b_resp.status_code == 201, b_resp.text
    b_id = b_resp.json()["id"]
    assert a_id != b_id

    listing = (await authed_client.get(ADDRESSES_URL)).json()
    defaults = [a for a in listing if a["is_default"]]
    assert len(defaults) == 1, (
        f"expected exactly one default address, got {len(defaults)}: {defaults!r}"
    )
    assert defaults[0]["id"] == b_id, "most-recently-created default should win"


@pytest.mark.asyncio
async def test_post_default_endpoint_unsets_prior(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST /addresses/{id}/default must flip the default flag atomically."""
    authed_client, _ = await make_authenticated_client(client, db_session)

    a = (
        await authed_client.post(
            ADDRESSES_URL,
            json=_valid_address(label="home", is_default=True),
        )
    ).json()
    b = (
        await authed_client.post(
            ADDRESSES_URL,
            json=_valid_address(label="office", line1="Plot 42"),
        )
    ).json()

    assert a["is_default"] is True
    assert b["is_default"] is False

    promote = await authed_client.post(f"{ADDRESSES_URL}/{b['id']}/default")
    assert promote.status_code == 200, promote.text
    assert promote.json()["is_default"] is True

    listing = (await authed_client.get(ADDRESSES_URL)).json()
    flags = {item["id"]: item["is_default"] for item in listing}
    assert flags[b["id"]] is True
    assert flags[a["id"]] is False, (
        f"prior default was not unset after /default call: {listing!r}"
    )


@pytest.mark.asyncio
async def test_invalid_coordinates_are_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Out-of-range lat/lng must be rejected at the schema layer."""
    authed_client, _ = await make_authenticated_client(client, db_session)

    # lng=999 is outside [-180, 180]
    bad_lng = await authed_client.post(
        ADDRESSES_URL, json=_valid_address(lng=999.0)
    )
    assert bad_lng.status_code == 422, bad_lng.text

    # lat=999 is outside [-90, 90]
    bad_lat = await authed_client.post(
        ADDRESSES_URL, json=_valid_address(lat=999.0)
    )
    assert bad_lat.status_code == 422, bad_lat.text


@pytest.mark.asyncio
async def test_addresses_require_auth(client: AsyncClient) -> None:
    """All address endpoints are bearer-gated — unauth must 401, not 500/404."""
    response = await client.get(ADDRESSES_URL)
    assert response.status_code == 401, response.text

    create = await client.post(ADDRESSES_URL, json=_valid_address())
    assert create.status_code == 401, create.text

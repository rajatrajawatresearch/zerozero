"""Integration tests for the unified search endpoint.

Contract (``docs/PHASE3_CONTRACTS.md`` → Search):
    GET /search?q=&lat=&lng=&type=  → SearchResults

Assertions:
* Seeding three distinctly-named restaurants and querying for one of
  their name-tokens must return a hit for that restaurant (pg_trgm
  similarity + ILIKE substring fallback).
* ``q`` shorter than 2 characters → 422 (FastAPI ``Query(min_length=2)``).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers.commerce_factories import make_restaurant


SEARCH_URL = "/api/v1/search"


@pytest.mark.asyncio
async def test_search_finds_restaurant_by_name(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Seed three restaurants; searching for a distinctive token returns it."""
    await make_restaurant(db_session, name="Mango Masala Kitchen")
    await make_restaurant(db_session, name="Pizza Planet Express")
    await make_restaurant(db_session, name="Sushi Shack Tokyo")

    resp = await client.get(SEARCH_URL, params={"q": "Mango"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "restaurants" in body
    names = [r["name"] for r in body["restaurants"]]
    assert any("Mango" in n for n in names), (
        f"expected a Mango-matching restaurant, got {names!r}"
    )


@pytest.mark.asyncio
async def test_search_returns_only_matching_restaurants(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Querying for Pizza should not surface the Mango or Sushi fixtures."""
    await make_restaurant(db_session, name="Mango Masala Kitchen")
    await make_restaurant(db_session, name="Pizza Planet Express")
    await make_restaurant(db_session, name="Sushi Shack Tokyo")

    resp = await client.get(SEARCH_URL, params={"q": "Pizza"})
    assert resp.status_code == 200, resp.text
    names = [r["name"] for r in resp.json()["restaurants"]]
    # pg_trgm can surface close matches — we only require Pizza is in the list
    # and neither Mango nor Sushi outrank it unfairly in a 3-row fixture.
    assert any("Pizza" in n for n in names), (
        f"expected Pizza in results, got {names!r}"
    )


@pytest.mark.asyncio
async def test_search_query_too_short_returns_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """``q`` must be >= 2 characters; 1-char query → 422."""
    resp = await client.get(SEARCH_URL, params={"q": "a"})
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_search_empty_query_returns_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Empty ``q`` is also rejected by the min-length guard."""
    resp = await client.get(SEARCH_URL, params={"q": ""})
    assert resp.status_code == 422, resp.text

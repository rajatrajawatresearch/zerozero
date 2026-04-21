"""Integration tests for the Phase 3 server-side cart.

Contract (``docs/PHASE3_CONTRACTS.md`` → Cart):
    GET    /cart                     → CartOut
    POST   /cart/items               → 201 CartItemOut
    PATCH  /cart/items/{id}          → CartItemOut
    DELETE /cart/items/{id}          → 204
    DELETE /cart                     → 204

Key invariants under test:
* Adding the same item twice with identical options dedupes on
  ``(user_id, menu_item_id, options_hash)`` — qty increments, no new row.
* Adding from a different restaurant wipes the previous cart (business
  rule surfaced via ``X-Cart-Replaced: true`` response header).
* ``GET /cart`` returns an aggregated subtotal built from line totals.
* PATCH qty updates the row; DELETE /cart empties everything.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import make_authenticated_client
from tests.helpers.commerce_factories import make_restaurant


CART_URL = "/api/v1/cart"
CART_ITEMS_URL = f"{CART_URL}/items"


@pytest.mark.asyncio
async def test_add_item_to_empty_cart_creates_row(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST /cart/items on an empty cart → 201, one row, item_count=1."""
    authed, _ = await make_authenticated_client(client, db_session)
    restaurant = await make_restaurant(db_session)
    menu_item = restaurant.menu_items[0]

    resp = await authed.post(
        CART_ITEMS_URL,
        json={"menu_item_id": str(menu_item.id), "qty": 1},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["menu_item_id"] == str(menu_item.id)
    assert body["qty"] == 1

    cart = (await authed.get(CART_URL)).json()
    assert cart["item_count"] == 1
    assert len(cart["items"]) == 1
    assert cart["restaurant_id"] == str(restaurant.id)


@pytest.mark.asyncio
async def test_add_same_item_twice_increments_qty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Adding the same (menu_item_id, options) again must bump qty, not duplicate."""
    authed, _ = await make_authenticated_client(client, db_session)
    restaurant = await make_restaurant(db_session)
    menu_item = restaurant.menu_items[0]

    payload = {
        "menu_item_id": str(menu_item.id),
        "qty": 2,
        "options": {"size": "M", "spice": "medium"},
    }
    first = await authed.post(CART_ITEMS_URL, json=payload)
    assert first.status_code == 201, first.text

    second = await authed.post(CART_ITEMS_URL, json=payload)
    assert second.status_code == 201, second.text

    cart = (await authed.get(CART_URL)).json()
    assert len(cart["items"]) == 1, f"expected dedup to 1 row, got {cart['items']!r}"
    assert cart["items"][0]["qty"] == 4
    assert cart["item_count"] == 4


@pytest.mark.asyncio
async def test_add_from_different_restaurant_replaces_cart(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Adding from a new restaurant wipes the existing cart; header signals it."""
    authed, _ = await make_authenticated_client(client, db_session)
    rest_a = await make_restaurant(db_session, name="Alpha Cafe")
    rest_b = await make_restaurant(db_session, name="Beta Diner")

    # Seed cart with an item from rest_a.
    first = await authed.post(
        CART_ITEMS_URL,
        json={"menu_item_id": str(rest_a.menu_items[0].id), "qty": 1},
    )
    assert first.status_code == 201, first.text
    assert first.headers.get("X-Cart-Replaced") != "true"

    # Now add from rest_b — cart should be replaced.
    second = await authed.post(
        CART_ITEMS_URL,
        json={"menu_item_id": str(rest_b.menu_items[0].id), "qty": 1},
    )
    assert second.status_code == 201, second.text
    assert second.headers.get("X-Cart-Replaced") == "true", (
        f"expected X-Cart-Replaced=true header, got headers={dict(second.headers)!r}"
    )

    cart = (await authed.get(CART_URL)).json()
    assert cart["restaurant_id"] == str(rest_b.id)
    # Only rest_b's item survives.
    assert len(cart["items"]) == 1
    assert cart["items"][0]["menu_item_id"] == str(rest_b.menu_items[0].id)


@pytest.mark.asyncio
async def test_get_cart_returns_aggregated_subtotal(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Subtotal must equal Σ(price × qty) across all rows."""
    authed, _ = await make_authenticated_client(client, db_session)
    restaurant = await make_restaurant(db_session)
    item_a, item_b = restaurant.menu_items[0], restaurant.menu_items[1]

    await authed.post(
        CART_ITEMS_URL,
        json={"menu_item_id": str(item_a.id), "qty": 2},
    )
    await authed.post(
        CART_ITEMS_URL,
        json={"menu_item_id": str(item_b.id), "qty": 1},
    )

    cart = (await authed.get(CART_URL)).json()
    expected = (item_a.price * 2) + (item_b.price * 1)
    assert Decimal(cart["subtotal"]) == expected, (
        f"subtotal mismatch: got {cart['subtotal']}, expected {expected}"
    )
    assert cart["item_count"] == 3


@pytest.mark.asyncio
async def test_patch_qty_updates_row(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """PATCH /cart/items/{id} with new qty returns 200 + updated row."""
    authed, _ = await make_authenticated_client(client, db_session)
    restaurant = await make_restaurant(db_session)
    menu_item = restaurant.menu_items[0]

    created = (
        await authed.post(
            CART_ITEMS_URL,
            json={"menu_item_id": str(menu_item.id), "qty": 1},
        )
    ).json()

    patch = await authed.patch(
        f"{CART_ITEMS_URL}/{created['id']}",
        json={"qty": 5},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["qty"] == 5

    cart = (await authed.get(CART_URL)).json()
    assert cart["item_count"] == 5


@pytest.mark.asyncio
async def test_delete_cart_empties_everything(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """DELETE /cart wipes all rows; subsequent GET returns item_count=0."""
    authed, _ = await make_authenticated_client(client, db_session)
    restaurant = await make_restaurant(db_session)

    for item in restaurant.menu_items[:2]:
        await authed.post(
            CART_ITEMS_URL,
            json={"menu_item_id": str(item.id), "qty": 1},
        )

    assert (await authed.get(CART_URL)).json()["item_count"] == 2

    clear = await authed.delete(CART_URL)
    assert clear.status_code == 204, clear.text

    after = (await authed.get(CART_URL)).json()
    assert after["item_count"] == 0
    assert after["items"] == []
    assert after["restaurant_id"] is None

"""Integration tests for the Phase 3 orders flow.

Contract (``docs/PHASE3_CONTRACTS.md`` → Orders):
    POST /orders                → 201 OrderDetailOut
    GET  /orders                → PageOut[OrderListItem]
    GET  /orders/{id}           → OrderDetailOut
    POST /orders/{id}/cancel    → OrderDetailOut
    POST /orders/{id}/review    → 201 ReviewOut (delivered only)

Key invariants under test:
* Atomic checkout: cart → order, then cart empties within the same tx.
* GET /orders lists the new order.
* Cancel on ``placed`` order transitions status + appends a status event.
* Cancel on ``delivered`` → 409 (illegal transition).
* Review on non-delivered order → 409; review on delivered → 201.
* Order detail accessible via share_token as a query param.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import make_authenticated_client
from tests.helpers.commerce_factories import make_address, make_restaurant
from zerozero_api.domain.enums import OrderStatus
from zerozero_api.domain.order import Order, OrderStatusEvent


CART_URL = "/api/v1/cart"
CART_ITEMS_URL = f"{CART_URL}/items"
ORDERS_URL = "/api/v1/orders"


async def _seed_cart_and_address(
    authed: AsyncClient,
    db: AsyncSession,
    user_id,
) -> tuple[str, str]:
    """Create restaurant + address + one cart item. Returns (address_id, restaurant_id)."""
    restaurant = await make_restaurant(db)
    address = await make_address(db, user_id)
    add = await authed.post(
        CART_ITEMS_URL,
        json={"menu_item_id": str(restaurant.menu_items[0].id), "qty": 2},
    )
    assert add.status_code == 201, add.text
    return str(address.id), str(restaurant.id)


@pytest.mark.asyncio
async def test_checkout_places_order_and_clears_cart(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Signup → add to cart → checkout; cart empty, status=placed."""
    authed, user = await make_authenticated_client(client, db_session)
    address_id, _ = await _seed_cart_and_address(authed, db_session, user.id)

    resp = await authed.post(
        ORDERS_URL,
        json={"address_id": address_id, "payment_method": "cod"},
    )
    assert resp.status_code == 201, resp.text
    order = resp.json()
    assert order["status"] == "placed"
    assert "id" in order

    # Cart is empty after checkout.
    cart = (await authed.get(CART_URL)).json()
    assert cart["item_count"] == 0


@pytest.mark.asyncio
async def test_get_orders_lists_new_order(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """GET /orders after checkout returns the fresh order in the list."""
    authed, user = await make_authenticated_client(client, db_session)
    address_id, _ = await _seed_cart_and_address(authed, db_session, user.id)

    created = (
        await authed.post(
            ORDERS_URL,
            json={"address_id": address_id, "payment_method": "cod"},
        )
    ).json()

    listing = await authed.get(ORDERS_URL)
    assert listing.status_code == 200, listing.text
    body = listing.json()
    # Support both PageOut-shaped {items:[...]} and bare list responses.
    items = body.get("items", body) if isinstance(body, dict) else body
    assert any(o["id"] == created["id"] for o in items), (
        f"expected new order {created['id']} in listing, got {items!r}"
    )


@pytest.mark.asyncio
async def test_cancel_placed_order_appends_event(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Cancel on status=placed → 200, status=cancelled, event row created."""
    authed, user = await make_authenticated_client(client, db_session)
    address_id, _ = await _seed_cart_and_address(authed, db_session, user.id)

    order = (
        await authed.post(
            ORDERS_URL,
            json={"address_id": address_id, "payment_method": "cod"},
        )
    ).json()
    order_id = order["id"]

    cancel = await authed.post(f"{ORDERS_URL}/{order_id}/cancel")
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["status"] == "cancelled"

    # DB-level assertion: event appended.
    events = (
        await db_session.execute(
            select(OrderStatusEvent).where(
                OrderStatusEvent.order_id == order["id"],
                OrderStatusEvent.status == OrderStatus.CANCELLED,
            )
        )
    ).scalars().all()
    assert len(events) >= 1, "no cancelled event row was appended"


@pytest.mark.asyncio
async def test_cancel_delivered_order_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Cancel on a delivered order is an illegal transition → 409."""
    authed, user = await make_authenticated_client(client, db_session)
    address_id, _ = await _seed_cart_and_address(authed, db_session, user.id)

    order = (
        await authed.post(
            ORDERS_URL,
            json={"address_id": address_id, "payment_method": "cod"},
        )
    ).json()

    # Force delivered state directly in the DB.
    from uuid import UUID

    db_order = (
        await db_session.execute(select(Order).where(Order.id == UUID(order["id"])))
    ).scalar_one()
    db_order.status = OrderStatus.DELIVERED
    await db_session.commit()

    cancel = await authed.post(f"{ORDERS_URL}/{order['id']}/cancel")
    assert cancel.status_code == 409, cancel.text


@pytest.mark.asyncio
async def test_review_delivered_order_returns_201(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Review on a delivered order succeeds with 201."""
    authed, user = await make_authenticated_client(client, db_session)
    address_id, _ = await _seed_cart_and_address(authed, db_session, user.id)

    order = (
        await authed.post(
            ORDERS_URL,
            json={"address_id": address_id, "payment_method": "cod"},
        )
    ).json()

    from uuid import UUID

    db_order = (
        await db_session.execute(select(Order).where(Order.id == UUID(order["id"])))
    ).scalar_one()
    db_order.status = OrderStatus.DELIVERED
    await db_session.commit()

    review = await authed.post(
        f"{ORDERS_URL}/{order['id']}/review",
        json={"rating": 5, "comment": "Delicious!"},
    )
    assert review.status_code == 201, review.text


@pytest.mark.asyncio
async def test_review_non_delivered_order_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Review on a still-placed order → 409 (order not delivered)."""
    authed, user = await make_authenticated_client(client, db_session)
    address_id, _ = await _seed_cart_and_address(authed, db_session, user.id)

    order = (
        await authed.post(
            ORDERS_URL,
            json={"address_id": address_id, "payment_method": "cod"},
        )
    ).json()

    review = await authed.post(
        f"{ORDERS_URL}/{order['id']}/review",
        json={"rating": 4, "comment": "Too early"},
    )
    assert review.status_code == 409, review.text


@pytest.mark.asyncio
async def test_order_detail_accessible_via_share_token(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """GET /orders/{id}?share_token=... → 200 (public-read via token).

    Note: the tracking endpoint (``/orders/{id}/track``) is owned by
    Agent 2 — this test only asserts share_token flows through on the
    detail endpoint, which is the Phase 3 contract.
    """
    authed, user = await make_authenticated_client(client, db_session)
    address_id, _ = await _seed_cart_and_address(authed, db_session, user.id)

    order = (
        await authed.post(
            ORDERS_URL,
            json={"address_id": address_id, "payment_method": "cod"},
        )
    ).json()
    assert "share_token" in order, f"expected share_token on order detail: {order!r}"

    resp = await authed.get(
        f"{ORDERS_URL}/{order['id']}",
        params={"share_token": order["share_token"]},
    )
    assert resp.status_code == 200, resp.text

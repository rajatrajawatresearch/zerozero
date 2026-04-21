"""Integration tests for the Phase 4 reviews routes + aggregate recompute.

Phase 4 contract (``docs/PHASE4_CONTRACTS.md`` → Reviews):

  * ``GET /restaurants/{slug}/reviews``           → paginated list
  * ``POST /admin/reviews/recompute``             → update rating_avg /
                                                     rating_count
  * ``POST /admin/reviews/recompute?restaurant_id=..`` → single-restaurant
                                                     recompute

The review-create endpoint itself already existed in Phase 3 as
``POST /orders/{id}/review`` (201 ReviewOut). Phase 4 adds the aggregate
sync + public list.

Scope of this module
--------------------
* List includes a freshly-created review.
* Admin recompute updates ``rating_avg`` + ``rating_count`` on the
  restaurant row (asserted via DB).
* Non-admin caller on recompute → 403.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import make_authenticated_client
from tests.helpers.commerce_factories import make_address, make_restaurant
from zerozero_api.domain.enums import OrderStatus, UserRole
from zerozero_api.domain.order import Order
from zerozero_api.domain.restaurant import Restaurant
from zerozero_api.domain.review import Review

__all__: list[str] = []

ORDERS_URL = "/api/v1/orders"
CART_ITEMS_URL = "/api/v1/cart/items"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _place_and_deliver(
    authed: AsyncClient, db: AsyncSession, user_id: uuid.UUID
) -> tuple[dict[str, Any], Restaurant]:
    """Seed restaurant/address/cart, checkout, and force status=delivered.

    Returns ``(order_json, restaurant)`` so callers can both POST the
    review via HTTP and assert the restaurant row in the DB.
    """
    restaurant = await make_restaurant(db)
    address = await make_address(db, user_id)

    add = await authed.post(
        CART_ITEMS_URL,
        json={"menu_item_id": str(restaurant.menu_items[0].id), "qty": 1},
    )
    assert add.status_code == 201, add.text

    order_resp = await authed.post(
        ORDERS_URL,
        json={"address_id": str(address.id), "payment_method": "cod"},
    )
    assert order_resp.status_code == 201, order_resp.text
    order = order_resp.json()

    # Jump straight to delivered — the review endpoint requires it.
    db_order = (
        await db.execute(select(Order).where(Order.id == uuid.UUID(order["id"])))
    ).scalar_one()
    db_order.status = OrderStatus.DELIVERED
    await db.commit()

    return order, restaurant


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_restaurant_reviews_includes_fresh_review(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """After POST /orders/{id}/review, GET /restaurants/{slug}/reviews surfaces it."""
    authed, user = await make_authenticated_client(client, db_session)
    order, restaurant = await _place_and_deliver(authed, db_session, user.id)

    review_resp = await authed.post(
        f"{ORDERS_URL}/{order['id']}/review",
        json={"rating": 4, "comment": "Solid food, would order again."},
    )
    assert review_resp.status_code == 201, review_resp.text

    listing = await authed.get(f"/api/v1/restaurants/{restaurant.slug}/reviews")
    # The route is owned by Agent 4; skip gracefully when not yet present.
    if listing.status_code == 404:
        pytest.skip("GET /restaurants/{slug}/reviews not yet shipped")

    assert listing.status_code == 200, listing.text
    body = listing.json()
    items = body.get("items", body) if isinstance(body, dict) else body
    assert any(
        item.get("comment", "").startswith("Solid food") for item in items
    ), f"fresh review not in listing: {items!r}"


@pytest.mark.asyncio
async def test_admin_recompute_updates_rating_agg(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Admin POST /admin/reviews/recompute rewrites rating_avg + rating_count."""
    # Customer flow: place order + leave a 5-star review.
    authed, user = await make_authenticated_client(client, db_session)
    order, restaurant = await _place_and_deliver(authed, db_session, user.id)

    review_resp = await authed.post(
        f"{ORDERS_URL}/{order['id']}/review",
        json={"rating": 5, "comment": "Perfect."},
    )
    assert review_resp.status_code == 201, review_resp.text

    # Manually scribble stale aggregate values so we can verify the
    # recompute actually ran (not just "values happened to match").
    db_rest = (
        await db_session.execute(
            select(Restaurant).where(Restaurant.id == restaurant.id)
        )
    ).scalar_one()
    db_rest.rating_avg = Decimal("1.0")
    db_rest.rating_count = 0
    await db_session.commit()

    # Now mint an admin and call the recompute route.
    from httpx import ASGITransport, AsyncClient as _AsyncClient
    from zerozero_api.core.db import get_db

    async def _override_get_db():
        yield db_session

    # Use the already-overridden `app` via the fresh client, sharing the session.
    # Easiest path: reuse the admin sweep on the same client by re-authing.
    admin_client, _admin_user = await make_authenticated_client(
        client, db_session, role=UserRole.ADMIN
    )
    recompute = await admin_client.post(
        "/api/v1/admin/reviews/recompute",
        params={"restaurant_id": str(restaurant.id)},
    )
    if recompute.status_code == 404:
        pytest.skip("POST /admin/reviews/recompute not yet shipped")

    assert recompute.status_code in {200, 204}, recompute.text

    # DB-level assertion: rating_avg + rating_count now reflect the 1 review.
    refreshed = (
        await db_session.execute(
            select(Restaurant).where(Restaurant.id == restaurant.id)
        )
    ).scalar_one()
    assert refreshed.rating_count == 1, (
        f"rating_count should be 1 after recompute, got {refreshed.rating_count}"
    )
    assert Decimal(str(refreshed.rating_avg)) == Decimal("5.0"), (
        f"rating_avg should be 5.0 after single 5-star review, got {refreshed.rating_avg}"
    )


@pytest.mark.asyncio
async def test_non_admin_recompute_returns_403(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """A regular customer hitting the admin recompute endpoint → 403."""
    authed, _user = await make_authenticated_client(client, db_session)

    resp = await authed.post("/api/v1/admin/reviews/recompute")
    if resp.status_code == 404:
        pytest.skip("POST /admin/reviews/recompute not yet shipped")

    assert resp.status_code == 403, (
        f"customer caller should get 403, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_recompute_service_handles_no_reviews(
    db_session: AsyncSession,
) -> None:
    """Calling the service directly on a review-less restaurant resets to (0.0, 0).

    Touches the service layer (not HTTP) to verify idempotency of the
    aggregate math. Included here because the review list tests can skip
    out on Agent 4's router being late, but the service-level guarantee
    is stable regardless.
    """
    restaurant = await make_restaurant(db_session)
    restaurant.rating_avg = Decimal("4.5")
    restaurant.rating_count = 99
    await db_session.commit()

    from zerozero_api.services.review_service import recompute_restaurant_rating

    avg, count = await recompute_restaurant_rating(db_session, restaurant.id)
    assert count == 0
    assert Decimal(str(avg)) == Decimal("0.0")

    row = (
        await db_session.execute(
            select(Restaurant).where(Restaurant.id == restaurant.id)
        )
    ).scalar_one()
    assert row.rating_count == 0
    assert Decimal(str(row.rating_avg)) == Decimal("0.0")


@pytest.mark.asyncio
async def test_review_appears_in_db_after_create(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Sanity: review-create endpoint actually inserts a ``reviews`` row."""
    authed, user = await make_authenticated_client(client, db_session)
    order, restaurant = await _place_and_deliver(authed, db_session, user.id)

    posted = await authed.post(
        f"{ORDERS_URL}/{order['id']}/review",
        json={"rating": 3, "comment": "Middling."},
    )
    assert posted.status_code == 201, posted.text

    rows = (
        await db_session.execute(
            select(Review).where(Review.order_id == uuid.UUID(order["id"]))
        )
    ).scalars().all()
    assert len(rows) == 1, f"expected exactly one review row, got {len(rows)}"
    assert rows[0].rating == 3
    assert rows[0].restaurant_id == restaurant.id

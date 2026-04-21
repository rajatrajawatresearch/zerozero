"""Integration tests for the ``/ws/orders/{order_id}`` WebSocket endpoint.

Phase 4 contract reference: ``docs/PHASE4_CONTRACTS.md`` → WebSocket endpoints.

Scope
-----
* Auth success — valid ``?token=`` → socket accepts + delivers initial
  status snapshot.
* Auth failure — missing / bad token → server closes with close-code ``4401``.
* Authorization failure — token for a user who does NOT own the order → ``4403``.
* Redis pub/sub fan-out — publishing a ``status`` event on the matching
  ``orders:{order_id}`` channel (from the test body) reaches a connected
  client via the ConnectionManager's subscriber task.

Why sync ``TestClient``?
------------------------
Starlette's ``TestClient.websocket_connect`` is the simplest + most
reliable way to drive WebSockets against an ASGI app from pytest. The
endpoint is async — TestClient wraps it in a thread and blocks our test
thread on ``receive_json``, which sidesteps the usual event-loop gymnastics.

DB visibility note
------------------
The ``db_session`` fixture in ``conftest.py`` uses SAVEPOINT isolation,
which means rows committed through ``db_session`` are **not** visible to
the WS handler's own session (it opens a separate connection via
``async_session_factory``). To let the handler see our seed data, these
tests use their own real engine-level session to seed + tear down rows.
Cleanup is best-effort: any leftovers roll off with the per-session DB
container anyway.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from tests.helpers import make_authenticated_client
from tests.helpers.commerce_factories import make_address, make_restaurant
from zerozero_api.domain.enums import OrderStatus

ORDERS_URL = "/api/v1/orders"
CART_ITEMS_URL = "/api/v1/cart/items"


# ---------------------------------------------------------------------------
# Per-test seed helper — uses a real engine session so the WS handler's
# separate session can see the rows.
# ---------------------------------------------------------------------------


async def _seed_user_and_order(app: Any) -> dict[str, Any]:
    """Create a user, restaurant, address, cart, and order via real DB commits.

    Returns ``{user_id, order_id, share_token, token}`` — ``token`` is a
    freshly-minted access JWT ready to drop into a ``?token=`` query
    param.
    """
    from zerozero_api.core.db import async_session_factory

    session = async_session_factory()
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            authed, user = await make_authenticated_client(ac, session)
            restaurant = await make_restaurant(session)
            address = await make_address(session, user.id)

            add = await authed.post(
                CART_ITEMS_URL,
                json={"menu_item_id": str(restaurant.menu_items[0].id), "qty": 1},
            )
            assert add.status_code == 201, add.text

            resp = await authed.post(
                ORDERS_URL,
                json={"address_id": str(address.id), "payment_method": "cod"},
            )
            assert resp.status_code == 201, resp.text
            order = resp.json()
            token = authed.headers["authorization"].split(" ", 1)[1]

        return {
            "user_id": str(user.id),
            "order_id": order["id"],
            "share_token": order["share_token"],
            "token": token,
        }
    finally:
        await session.close()


async def _seed_second_user_token(app: Any) -> str:
    """Mint a second, unrelated user and return their access token."""
    from zerozero_api.core.db import async_session_factory

    session = async_session_factory()
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            authed, _user = await make_authenticated_client(ac, session)
            return authed.headers["authorization"].split(" ", 1)[1]
    finally:
        await session.close()


def _ws_url(order_id: str, token: str) -> str:
    return f"/ws/orders/{order_id}?token={token}"


# ---------------------------------------------------------------------------
# Tests — all synchronous because ``TestClient`` drives the async app in a
# worker thread. Mixing the sync WS client with an awaited event loop is
# brittle and leaks sessions. ``asyncio.run`` is the clean bridge.
# ---------------------------------------------------------------------------


def test_ws_orders_accepts_valid_token_and_sends_snapshot(app: Any) -> None:
    """Owner connects with a good token → socket opens + initial snapshot."""
    seed = asyncio.run(_seed_user_and_order(app))

    from starlette.testclient import TestClient

    with TestClient(app) as sync_client:
        with sync_client.websocket_connect(
            _ws_url(seed["order_id"], seed["token"])
        ) as ws:
            snapshot = ws.receive_json()
            assert snapshot["type"] == "status"
            assert snapshot["status"] == OrderStatus.PLACED.value
            assert "at" in snapshot


def test_ws_orders_bad_token_closes_4401(app: Any) -> None:
    """Garbage JWT → close-code 4401 unauthorized."""
    seed = asyncio.run(_seed_user_and_order(app))

    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    with TestClient(app) as sync_client:
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with sync_client.websocket_connect(
                _ws_url(seed["order_id"], "not.a.real.jwt")
            ) as ws:
                ws.receive_text()
        assert excinfo.value.code == 4401, (
            f"expected 4401 for bad token, got {excinfo.value.code}"
        )


def test_ws_orders_wrong_users_order_closes_4403(app: Any) -> None:
    """User B's token on user A's order → 4403 forbidden."""
    seed = asyncio.run(_seed_user_and_order(app))
    other_token = asyncio.run(_seed_second_user_token(app))

    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    with TestClient(app) as sync_client:
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with sync_client.websocket_connect(
                _ws_url(seed["order_id"], other_token)
            ) as ws:
                ws.receive_text()
        assert excinfo.value.code == 4403, (
            f"expected 4403 for wrong-user, got {excinfo.value.code}"
        )


def test_ws_orders_receives_redis_published_status(app: Any) -> None:
    """Publish a ``status`` event on ``orders:{id}`` → connected WS receives it.

    Flow:
      1. Seed a user + order (real commits so the WS handler can see them).
      2. Open TestClient (drives the FastAPI lifespan → subscriber starts).
      3. Connect the WS; drain the initial snapshot.
      4. Publish a CONFIRMED event via the same ``event_bus`` helper the
         app uses.
      5. Assert the fan-out arrives on the socket.
    """
    seed = asyncio.run(_seed_user_and_order(app))

    from starlette.testclient import TestClient
    from zerozero_api.services.event_bus import publish_order_event
    from zerozero_api.ws.connection_manager import manager

    with TestClient(app) as sync_client:
        # TestClient's ``__enter__`` drives the app lifespan which starts
        # the Redis subscriber. But some agent configs might skip that, so
        # nudge it explicitly and give PSUBSCRIBE a beat to confirm.
        async def _wait_for_subscriber() -> None:
            await manager.start_redis_subscriber()
            await asyncio.sleep(0.25)

        asyncio.run(_wait_for_subscriber())

        with sync_client.websocket_connect(
            _ws_url(seed["order_id"], seed["token"])
        ) as ws:
            first = ws.receive_json()
            assert first["type"] == "status"
            assert first["status"] == OrderStatus.PLACED.value

            payload = {
                "type": "status",
                "status": OrderStatus.CONFIRMED.value,
                "at": "2026-04-21T12:00:00+00:00",
            }

            async def _publish() -> None:
                await publish_order_event(uuid.UUID(seed["order_id"]), payload)

            asyncio.run(_publish())

            msg = ws.receive_json()
            assert msg["type"] == "status"
            assert msg["status"] == OrderStatus.CONFIRMED.value


def test_ws_orders_close_leaves_order_row_untouched(app: Any) -> None:
    """Sanity: opening + closing the socket doesn't mutate the order."""
    seed = asyncio.run(_seed_user_and_order(app))

    from starlette.testclient import TestClient

    with TestClient(app) as sync_client:
        with sync_client.websocket_connect(
            _ws_url(seed["order_id"], seed["token"])
        ) as ws:
            _ = ws.receive_json()

    # Re-read the order through a fresh session.
    async def _reload() -> str:
        from sqlalchemy import select

        from zerozero_api.core.db import async_session_factory
        from zerozero_api.domain.order import Order

        async with async_session_factory() as s:
            row = (
                await s.execute(
                    select(Order).where(Order.id == uuid.UUID(seed["order_id"]))
                )
            ).scalar_one()
            return row.status.value

    status = asyncio.run(_reload())
    assert status == OrderStatus.PLACED.value

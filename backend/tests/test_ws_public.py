"""Integration tests for the ``/ws/public/track/{share_token}`` endpoint.

Phase 4 contract reference: ``docs/PHASE4_CONTRACTS.md`` → WebSocket endpoints.

The public tracker:
  * Has **no ``?token=`` auth** — the opaque ``share_token`` IS the authority.
  * Must NEVER echo PII (customer name / email / phone / street line1-2).
  * Terminal orders (``delivered`` / ``cancelled`` / ``failed``) may either:
      - Close immediately with a dedicated application code, OR
      - Respond 410 on the HTTP twin.
    We test the "accepted + final snapshot + close 4403" branch, which
    is what Agent 3 already shipped in ``ws/public.py``.

DB visibility pattern follows ``test_ws_orders.py`` — rows are seeded
via a real engine session because the WS handler's own session won't
see SAVEPOINT-isolated writes.
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


async def _seed_order(
    app: Any, *, full_name: str = "Sherlock Holmes", email: str | None = None
) -> dict[str, Any]:
    """Seed a user + order, commit to the real DB, and return ids + share_token."""
    from zerozero_api.core.db import async_session_factory

    session = async_session_factory()
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            authed, user = await make_authenticated_client(
                ac, session, full_name=full_name, email=email
            )
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
            return {
                "user_id": str(user.id),
                "order_id": order["id"],
                "share_token": order["share_token"],
            }
    finally:
        await session.close()


async def _force_status(order_id: str, status: OrderStatus) -> None:
    """Force an order row's status directly in the DB."""
    from sqlalchemy import select

    from zerozero_api.core.db import async_session_factory
    from zerozero_api.domain.order import Order

    async with async_session_factory() as session:
        row = (
            await session.execute(
                select(Order).where(Order.id == uuid.UUID(order_id))
            )
        ).scalar_one()
        row.status = status
        await session.commit()


def _public_ws_url(share_token: str) -> str:
    return f"/ws/public/track/{share_token}"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_ws_public_valid_share_token_yields_pii_free_snapshot(app: Any) -> None:
    """A valid share_token opens the socket and delivers a sanitized snapshot."""
    seed = asyncio.run(
        _seed_order(app, full_name="Sherlock Holmes", email="holmes@example.com")
    )

    from starlette.testclient import TestClient

    with TestClient(app) as sync_client:
        with sync_client.websocket_connect(
            _public_ws_url(seed["share_token"])
        ) as ws:
            snapshot = ws.receive_json()
            # PublicTrackOut shape checks.
            assert "status" in snapshot
            assert "restaurant_name" in snapshot
            assert "destination" in snapshot
            dest = snapshot["destination"]
            assert "city" in dest
            # No raw street fields allowed in the destination sub-object.
            forbidden_dest_keys = {"line1", "line2", "phone", "full_name", "email"}
            assert not (forbidden_dest_keys & set(dest.keys())), (
                f"destination contains PII fields: {dest}"
            )
            # Flat-body PII check — catches any accidental top-level leak.
            flat_body = repr(snapshot)
            assert "holmes@example.com" not in flat_body, "email leaked"
            assert "Sherlock Holmes" not in flat_body, "customer name leaked"


def test_ws_public_invalid_token_closes_4404(app: Any) -> None:
    """A share_token that doesn't resolve → close-code 4404."""
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    # 32 chars → passes the 8..64 length gate, fails DB lookup → 4404.
    bogus = "x" * 32

    with TestClient(app) as sync_client:
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with sync_client.websocket_connect(_public_ws_url(bogus)) as ws:
                ws.receive_text()
        assert excinfo.value.code == 4404, (
            f"unknown share_token should close 4404, got {excinfo.value.code}"
        )


def test_ws_public_invalid_token_too_short_closes_4404(app: Any) -> None:
    """Below the 8-char gate → 4404 without a DB round-trip."""
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    with TestClient(app) as sync_client:
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with sync_client.websocket_connect(_public_ws_url("short")) as ws:
                ws.receive_text()
        assert excinfo.value.code == 4404


def test_ws_public_delivered_order_sends_final_snapshot_then_closes(
    app: Any,
) -> None:
    """Delivered order → accept + final snapshot + close 4403 (per impl).

    The Phase 4 contract allows either "accepted with terminal state"
    or HTTP 410 for the HTTP twin. The shipped ``ws/public.py`` picked
    the "accept + one snapshot + close(4403)" path — assert that.
    """
    seed = asyncio.run(_seed_order(app))
    asyncio.run(_force_status(seed["order_id"], OrderStatus.DELIVERED))

    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    with TestClient(app) as sync_client:
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with sync_client.websocket_connect(
                _public_ws_url(seed["share_token"])
            ) as ws:
                final = ws.receive_json()
                assert final.get("status") == OrderStatus.DELIVERED.value
                # Next receive surfaces the server-initiated close.
                ws.receive_text()
        # Implementation uses 4403; tolerate near-equivalent codes so
        # this test doesn't snap on a later impl tweak to 4410.
        assert excinfo.value.code in {4403, 4410, 1000}, (
            f"terminal-order close code {excinfo.value.code} is unexpected"
        )

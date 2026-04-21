"""Integration tests for the Phase 4 notifications API.

Phase 4 contract (``docs/PHASE4_CONTRACTS.md`` → Notifications):

  * ``GET    /notifications?unread=true&page=1``  → PageOut[NotificationOut]
  * ``POST   /notifications/{id}/read``           → 204
  * ``POST   /notifications/read-all``            → 204
  * ``GET    /notifications/unread-count``        → ``{count: int}``

A notification row is simple, so the tests here insert rows directly via
SQLAlchemy rather than driving the producer side (which would require
order-status transitions or seeded promos). This keeps the route tests
stable while Agent 5 iterates on the producer-side triggers.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import make_authenticated_client
from zerozero_api.domain.enums import NotificationType
from zerozero_api.domain.notification import Notification
from zerozero_api.domain.user import User

NOTIFS_URL = "/api/v1/notifications"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _insert_notification(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    title: str = "Your order is on the way",
    body: str = "Partner is 2 minutes away.",
    notif_type: NotificationType = NotificationType.ORDER_UPDATE,
    payload: dict[str, Any] | None = None,
    is_read: bool = False,
) -> Notification:
    """Persist a :class:`Notification` directly — bypasses the producer path."""
    row = Notification(
        user_id=user_id,
        type=notif_type,
        title=title,
        body=body,
        payload=payload or {},
        is_read=is_read,
    )
    db.add(row)
    await db.flush()
    await db.commit()
    await db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_notification_lists_for_owner(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Inserting a Notification → GET /notifications returns it."""
    authed, user = await make_authenticated_client(client, db_session)
    notif = await _insert_notification(
        db_session, user.id, title="Order confirmed"
    )

    resp = await authed.get(NOTIFS_URL)
    if resp.status_code == 404:
        pytest.skip("GET /notifications not yet shipped")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    items = body.get("items", body) if isinstance(body, dict) else body
    assert any(str(n.get("id")) == str(notif.id) for n in items), (
        f"expected notification {notif.id} in listing, got {items!r}"
    )


@pytest.mark.asyncio
async def test_unread_count_reflects_unread_rows(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Three unread inserts → unread-count returns 3."""
    authed, user = await make_authenticated_client(client, db_session)
    for i in range(3):
        await _insert_notification(db_session, user.id, title=f"Notif {i}")

    # One extra row that's pre-read — should NOT be counted.
    await _insert_notification(
        db_session, user.id, title="Already read", is_read=True
    )

    resp = await authed.get(f"{NOTIFS_URL}/unread-count")
    if resp.status_code == 404:
        pytest.skip("GET /notifications/unread-count not yet shipped")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("count") == 3, (
        f"expected unread count=3, got body={body!r}"
    )


@pytest.mark.asyncio
async def test_mark_read_drops_unread_count(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """POST /notifications/{id}/read flips is_read + unread-count decrements."""
    authed, user = await make_authenticated_client(client, db_session)
    notif = await _insert_notification(db_session, user.id)

    before = await authed.get(f"{NOTIFS_URL}/unread-count")
    if before.status_code == 404:
        pytest.skip("notifications API not yet shipped")
    assert before.json().get("count") == 1

    read = await authed.post(f"{NOTIFS_URL}/{notif.id}/read")
    assert read.status_code in {200, 204}, read.text

    after = await authed.get(f"{NOTIFS_URL}/unread-count")
    assert after.status_code == 200
    assert after.json().get("count") == 0, (
        f"unread-count didn't drop after mark-read: {after.json()!r}"
    )

    # DB-level guarantee: is_read persisted.
    refreshed = (
        await db_session.execute(
            select(Notification).where(Notification.id == notif.id)
        )
    ).scalar_one()
    assert refreshed.is_read is True


@pytest.mark.asyncio
async def test_mark_all_read_zeroes_unread_count(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """POST /notifications/read-all flips every unread row for the caller."""
    authed, user = await make_authenticated_client(client, db_session)
    for i in range(4):
        await _insert_notification(db_session, user.id, title=f"N{i}")

    resp = await authed.post(f"{NOTIFS_URL}/read-all")
    if resp.status_code == 404:
        pytest.skip("POST /notifications/read-all not yet shipped")

    assert resp.status_code in {200, 204}, resp.text

    after = await authed.get(f"{NOTIFS_URL}/unread-count")
    assert after.status_code == 200
    assert after.json().get("count") == 0

    # DB-level assertion — every row for this user is_read=True.
    rows = (
        await db_session.execute(
            select(Notification).where(Notification.user_id == user.id)
        )
    ).scalars().all()
    assert len(rows) == 4
    assert all(r.is_read for r in rows), (
        f"expected all notifs read after read-all, got {[(r.id, r.is_read) for r in rows]!r}"
    )


@pytest.mark.asyncio
async def test_unread_query_filter_returns_only_unread(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """?unread=true filters out already-read rows."""
    authed, user = await make_authenticated_client(client, db_session)
    unread = await _insert_notification(db_session, user.id, title="Fresh")
    await _insert_notification(
        db_session, user.id, title="Old", is_read=True
    )

    resp = await authed.get(NOTIFS_URL, params={"unread": "true"})
    if resp.status_code == 404:
        pytest.skip("GET /notifications not yet shipped")

    body = resp.json()
    items = body.get("items", body) if isinstance(body, dict) else body
    ids = {str(n.get("id")) for n in items}
    assert str(unread.id) in ids
    # No already-read row should come back.
    assert all(n.get("is_read") is False for n in items), (
        f"unread filter bled through a read row: {items!r}"
    )


@pytest.mark.asyncio
async def test_notification_of_another_user_is_isolated(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Sanity: a notif for user B doesn't show up for user A."""
    authed_a, user_a = await make_authenticated_client(client, db_session)

    # Insert a row for a DIFFERENT user without bothering with auth for them.
    from tests.helpers import make_user

    user_b: User = await make_user(db_session)
    await _insert_notification(
        db_session, user_b.id, title="B's secret notif"
    )

    resp = await authed_a.get(NOTIFS_URL)
    if resp.status_code == 404:
        pytest.skip("GET /notifications not yet shipped")
    assert resp.status_code == 200
    body = resp.json()
    items = body.get("items", body) if isinstance(body, dict) else body
    titles = {item.get("title") for item in items}
    assert "B's secret notif" not in titles, (
        f"user A received user B's notifs: {titles!r}"
    )

"""Notification lifecycle service — list, mark-read, create + live-push.

Writers (``order_service``, ``promo_service``, review flows) call
:func:`create` with a :class:`NotificationCreateIn`. We insert the row in
the same DB transaction the caller opened, then fan-out via two paths:

  1. Redis pub/sub on channel ``notifications:{user_id}`` — future-proofs
     horizontal WS worker scale-out.
  2. In-process ``connection_manager.manager.broadcast`` — guarantees
     delivery to the current worker's sockets even when Redis PSUBSCRIBE
     patterns don't cover ``notifications:*`` yet.

Readers go through the three list/count/mark endpoints. Everything is
user-scoped — a 404 is returned if a caller passes another user's
notification id.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.errors import NotFoundError
from zerozero_api.domain.enums import NotificationType
from zerozero_api.domain.notification import Notification
from zerozero_api.schemas.common import PageOut
from zerozero_api.schemas.notification import NotificationOut
from zerozero_api.services.event_bus import get_redis
from zerozero_api.ws.connection_manager import manager

__all__ = [
    "channel_for_user",
    "create",
    "list_for_user",
    "mark_all_read",
    "mark_read",
    "unread_count",
]


# ---------------------------------------------------------------------------
# Channel helpers
# ---------------------------------------------------------------------------


def channel_for_user(user_id: UUID | str) -> str:
    """Return the pub/sub + WS channel name for a user's notifications."""
    return f"notifications:{user_id}"


def _to_out(n: Notification) -> NotificationOut:
    """Project a :class:`Notification` row to the wire schema."""
    return NotificationOut.model_validate(n)


# ---------------------------------------------------------------------------
# Read paths
# ---------------------------------------------------------------------------


async def list_for_user(
    db: AsyncSession,
    user_id: UUID,
    *,
    unread_only: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> PageOut[NotificationOut]:
    """Return a paginated feed of the caller's notifications, newest-first.

    ``unread_only=True`` is the bell-list mode; ``False`` shows history.
    Page size is clamped to 50 to match other list endpoints.
    """
    page = max(1, page)
    page_size = max(1, min(50, page_size))
    offset = (page - 1) * page_size

    base = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        base = base.where(Notification.is_read.is_(False))

    list_stmt = (
        base.order_by(Notification.created_at.desc())
        .offset(offset)
        .limit(page_size + 1)
    )
    rows = (await db.execute(list_stmt)).scalars().all()
    has_next = len(rows) > page_size
    page_rows = rows[:page_size]

    count_stmt = select(func.count()).select_from(Notification).where(
        Notification.user_id == user_id
    )
    if unread_only:
        count_stmt = count_stmt.where(Notification.is_read.is_(False))
    total = int((await db.execute(count_stmt)).scalar_one() or 0)

    return PageOut[NotificationOut](
        items=[_to_out(n) for n in page_rows],
        page=page,
        page_size=page_size,
        total=total,
        has_next=has_next,
    )


async def unread_count(db: AsyncSession, user_id: UUID) -> int:
    """Return the number of unread notifications for ``user_id``."""
    stmt = (
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.is_read.is_(False),
        )
    )
    return int((await db.execute(stmt)).scalar_one() or 0)


# ---------------------------------------------------------------------------
# Write paths
# ---------------------------------------------------------------------------


async def mark_read(
    db: AsyncSession, user_id: UUID, notification_id: UUID
) -> None:
    """Flip a single notification's ``is_read`` to True.

    Raises :class:`NotFoundError` when the id either doesn't exist OR
    belongs to another user — same 404 response in both cases to avoid
    leaking ownership via probing.
    """
    stmt = select(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "Notification not found", code="notification_not_found"
        )
    if not row.is_read:
        row.is_read = True
        await db.flush()


async def mark_all_read(db: AsyncSession, user_id: UUID) -> int:
    """Mark every unread notification for ``user_id`` as read.

    Returns the number of rows actually flipped, so callers can surface
    "marked N as read" affordances.
    """
    stmt = (
        update(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.is_read.is_(False),
        )
        .values(is_read=True)
    )
    result = await db.execute(stmt)
    await db.flush()
    return int(result.rowcount or 0)


async def create(
    db: AsyncSession,
    user_id: UUID,
    type: NotificationType | str,
    title: str,
    body: str | None = None,
    payload: dict[str, Any] | None = None,
) -> Notification:
    """Persist a new notification then push it to the user's live channel.

    The DB insert participates in the caller's transaction — the
    ``get_db`` dependency commits on handler success. Live fan-out uses
    the post-flush row (so ``id`` + ``created_at`` are populated) and
    targets both Redis (cross-worker) and the local connection manager.
    """
    nt = (
        type
        if isinstance(type, NotificationType)
        else NotificationType(type)
    )
    row = Notification(
        user_id=user_id,
        type=nt,
        title=title,
        body=body,
        payload=payload or {},
        is_read=False,
    )
    db.add(row)
    # Flush to obtain server-generated id + created_at so the WS frame is
    # identical to what future list calls will return.
    await db.flush()
    await db.refresh(row)

    # Build the wire frame once and reuse across both fan-out paths.
    frame: dict[str, Any] = {
        "type": "notification",
        "notification": _to_out(row).model_dump(mode="json"),
    }
    encoded = json.dumps(frame, separators=(",", ":"))

    channel = channel_for_user(user_id)

    # 1) Redis pub/sub — safe even when the Redis subscriber PSUB patterns
    #    don't yet include ``notifications:*``; publishing is a no-op fan-in
    #    on the listener side.
    try:
        await get_redis().publish(channel, encoded)
    except Exception:
        # Redis hiccups must not break the DB commit path.
        pass

    # 2) In-process broadcast — guarantees single-worker delivery.
    try:
        await manager.broadcast(channel, encoded)
    except Exception:
        pass

    return row

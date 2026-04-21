"""Notifications router — bell icon list, mark-read, and unread badge.

All routes require a logged-in user (``dependencies=[Depends(get_current_user)]``
at the router level). The route handlers themselves also accept the user
as a parameter so the service layer can scope every query by ``user_id``.

Routes (mounted under ``{API_V1_PREFIX}``):

  - ``GET    /notifications``                 → :class:`PageOut[NotificationOut]`
  - ``GET    /notifications/unread-count``    → :class:`UnreadCountOut`
  - ``POST   /notifications/{id}/read``       → 204
  - ``POST   /notifications/read-all``        → 204
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.deps import get_current_user
from zerozero_api.domain.user import User
from zerozero_api.schemas.common import PageOut
from zerozero_api.schemas.notification import NotificationOut, UnreadCountOut
from zerozero_api.services import notification_service

__all__ = ["router"]


router = APIRouter(
    prefix="/notifications",
    tags=["notifications"],
    dependencies=[Depends(get_current_user)],
)


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=PageOut[NotificationOut],
    summary="List the caller's notifications",
    description=(
        "Paginated notification feed, newest first. Pass ``unread=true`` "
        "for the bell-icon list; omit for the full history."
    ),
)
async def list_notifications_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    unread: Annotated[
        bool,
        Query(description="When true, return only ``is_read=false`` rows."),
    ] = False,
    page: Annotated[int, Query(ge=1, description="1-indexed page number.")] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=50, description="Page size (max 50).")
    ] = 20,
) -> PageOut[NotificationOut]:
    """Return a page of notifications for the caller."""
    return await notification_service.list_for_user(
        db,
        user.id,
        unread_only=unread,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------------------------------
# Unread count (bell badge)
# ---------------------------------------------------------------------------


@router.get(
    "/unread-count",
    response_model=UnreadCountOut,
    summary="Unread notification count",
    description="Returns ``{count: int}`` powering the header bell badge.",
)
async def unread_count_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> UnreadCountOut:
    """Return the caller's unread notification count."""
    count = await notification_service.unread_count(db, user.id)
    return UnreadCountOut(count=count)


# ---------------------------------------------------------------------------
# Mark one read
# ---------------------------------------------------------------------------


@router.post(
    "/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Mark a single notification as read",
    responses={404: {"description": "Notification not found or not owned by caller."}},
)
async def mark_read_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    notification_id: Annotated[UUID, Path(description="Notification UUID.")],
) -> Response:
    """Flip ``is_read=True`` on a single row; 404 if not the caller's."""
    await notification_service.mark_read(db, user.id, notification_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Mark all read
# ---------------------------------------------------------------------------


@router.post(
    "/read-all",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Mark every notification as read",
    description="Idempotent — safe to call when the list is already empty.",
)
async def mark_all_read_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Response:
    """Bulk flip of every unread row for the caller."""
    await notification_service.mark_all_read(db, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

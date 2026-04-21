"""Notification schemas — list response, internal create DTO, and unread count.

The ``Notification`` domain row is written by services (order_service,
promo_service, review workflows) via :func:`services.notification_service.create`.
Clients never call create directly; they only read, mark-read, and receive
live pushes over the ``/ws/notifications`` channel.

Shapes follow the Phase 4 contract in ``docs/PHASE4_CONTRACTS.md``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from zerozero_api.domain.enums import NotificationType

__all__ = [
    "NotificationCreateIn",
    "NotificationOut",
    "UnreadCountOut",
]


class NotificationOut(BaseModel):
    """Projection of a ``notifications`` row sent to clients.

    ``payload`` is open-schema JSONB so we can tack on order IDs, restaurant
    IDs, deep-link targets, etc. without a schema migration each time a new
    notification type lands.
    """

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)

    id: UUID = Field(..., description="Notification UUID.")
    type: NotificationType = Field(
        ..., description="Category used by the client to pick an icon / route."
    )
    title: str = Field(..., description="Short headline shown in the bell list.")
    body: str | None = Field(
        default=None,
        description="Optional secondary line; can be empty for minimal cards.",
    )
    payload: dict[str, Any] = Field(
        default_factory=dict,
        description="Type-specific structured data (order_id, deep-link, etc).",
    )
    is_read: bool = Field(
        ..., description="True once the user has acknowledged the notification."
    )
    created_at: datetime = Field(
        ..., description="Server-side insertion time (UTC, tz-aware)."
    )


class NotificationCreateIn(BaseModel):
    """Internal DTO used by other services to enqueue a notification.

    Not exposed on any HTTP route — external callers can only READ or
    MARK notifications. Emitters (order status transitions, promo drops,
    review reminders) build this struct then call
    :func:`services.notification_service.create`.
    """

    model_config = ConfigDict(extra="forbid")

    user_id: UUID = Field(..., description="Recipient user UUID.")
    type: NotificationType = Field(..., description="Notification category.")
    title: str = Field(..., min_length=1, max_length=200)
    body: str | None = Field(default=None, max_length=1024)
    payload: dict[str, Any] = Field(default_factory=dict)


class UnreadCountOut(BaseModel):
    """Tiny envelope for the bell-icon badge endpoint."""

    model_config = ConfigDict(from_attributes=True)

    count: int = Field(..., ge=0, description="Number of unread notifications.")

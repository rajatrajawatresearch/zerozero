"""In-app notifications (bell icon, toast feed).

``payload`` is JSONB so downstream clients can render type-specific UI
(order status, promo details, review reminders) without schema churn.
"""

from __future__ import annotations

from uuid import UUID
from datetime import datetime

from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from zerozero_api.domain.base import Base, UUIDPk
from zerozero_api.domain.enums import NotificationType

if TYPE_CHECKING:
    from datetime import datetime
    from uuid import UUID

    from zerozero_api.domain.user import User

__all__ = ["Notification"]


class Notification(UUIDPk, Base):
    __tablename__ = "notifications"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[NotificationType] = mapped_column(
        sa.Enum(NotificationType, name="notification_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(sa.String(1024), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB(), nullable=False, default=dict, server_default=sa.text("'{}'::jsonb")
    )
    is_read: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=False, server_default=sa.false(), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        index=True,
    )

    user: Mapped[User] = relationship(back_populates="notifications", lazy="selectin")

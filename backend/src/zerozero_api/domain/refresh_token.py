"""Issued refresh tokens.

A row is inserted every time ``POST /auth/login`` (or ``/auth/refresh``)
mints a new refresh JWT. The ``jti`` claim is the primary lookup key on
logout/rotation; we soft-revoke by setting ``revoked_at`` rather than
deleting so abuse can be audited.
"""

from __future__ import annotations

from uuid import UUID

from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from zerozero_api.domain.base import Base, UUIDPk

if TYPE_CHECKING:
    from uuid import UUID

    from zerozero_api.domain.user import User

__all__ = ["RefreshToken"]


class RefreshToken(UUIDPk, Base):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    jti: Mapped[str] = mapped_column(
        sa.String(64), nullable=False, unique=True, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, index=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )
    user_agent: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    ip: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)

    user: Mapped[User] = relationship(back_populates="refresh_tokens", lazy="selectin")

"""Theme presets — both built-in (user_id NULL) and user-saved.

Colours are stored as OKLCH strings ("0.65 0.2 30") so the frontend
can paste them straight into CSS custom properties.
"""

from __future__ import annotations

from uuid import UUID
from datetime import datetime

from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from zerozero_api.domain.base import Base, TimestampMixin, UUIDPk
from zerozero_api.domain.enums import ThemeMode, ThemeRadius

if TYPE_CHECKING:
    from uuid import UUID

    from zerozero_api.domain.user import User

__all__ = ["ThemePreset"]


class ThemePreset(UUIDPk, TimestampMixin, Base):
    __tablename__ = "theme_presets"

    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    primary_oklch: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    accent_oklch: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    mode: Mapped[ThemeMode] = mapped_column(
        sa.Enum(ThemeMode, name="theme_mode", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=ThemeMode.SYSTEM,
        server_default=ThemeMode.SYSTEM.value,
    )
    radius: Mapped[ThemeRadius] = mapped_column(
        sa.Enum(ThemeRadius, name="theme_radius", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=ThemeRadius.MD,
        server_default=ThemeRadius.MD.value,
    )

    user: Mapped[User | None] = relationship(
        back_populates="theme_presets", lazy="selectin"
    )

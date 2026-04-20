"""Cuisine tags applied to restaurants (many-to-many via ``restaurant_cuisines``).

Cuisines power two UX affordances:
  1. Homepage rail filters ("Italian", "North Indian", ...)
  2. Search facet counts (JOIN + GROUP BY on cuisine_id)
"""

from __future__ import annotations

from uuid import UUID
from datetime import datetime

from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from zerozero_api.domain.base import Base, TimestampMixin, UUIDPk

if TYPE_CHECKING:
    from zerozero_api.domain.restaurant import Restaurant

__all__ = ["Cuisine"]


class Cuisine(UUIDPk, TimestampMixin, Base):
    __tablename__ = "cuisines"

    name: Mapped[str] = mapped_column(sa.String(80), nullable=False, unique=True)
    slug: Mapped[str] = mapped_column(sa.String(80), nullable=False, unique=True, index=True)
    icon: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    is_veg_only: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=False, server_default=sa.false()
    )

    restaurants: Mapped[list[Restaurant]] = relationship(
        secondary="restaurant_cuisines",
        back_populates="cuisines",
        lazy="selectin",
    )

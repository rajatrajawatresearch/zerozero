"""Delivery addresses saved by a user.

Each row represents a named location ("Home", "Office") with its geocoded
point. We keep the point in ``geography(POINT, 4326)`` so PostGIS can run
``ST_DWithin`` against restaurant polygons in meters without reprojecting.
"""

from __future__ import annotations

from uuid import UUID
from datetime import datetime

from typing import TYPE_CHECKING

import sqlalchemy as sa
from geoalchemy2 import Geography, WKBElement
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from zerozero_api.domain.base import Base, TimestampMixin, UUIDPk

if TYPE_CHECKING:
    from uuid import UUID

    from zerozero_api.domain.order import Order
    from zerozero_api.domain.user import User

__all__ = ["Address"]


class Address(UUIDPk, TimestampMixin, Base):
    __tablename__ = "addresses"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    line1: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    line2: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    city: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    state: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    pincode: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    location: Mapped[WKBElement] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=False,
    )
    is_default: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=False, server_default=sa.false()
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    user: Mapped[User] = relationship(back_populates="addresses", lazy="selectin")
    orders: Mapped[list[Order]] = relationship(
        back_populates="address",
        lazy="selectin",
    )

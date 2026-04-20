"""Delivery-partner profile + location pings.

A ``DeliveryPartner`` is a 1-1 extension of ``User`` for users whose
role is ``PARTNER`` — separate table keeps partner-specific columns off
the main ``users`` table. ``partner_locations`` is an append-only stream
used to render the live tracking polyline.
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
from zerozero_api.domain.enums import VehicleType

if TYPE_CHECKING:
    from uuid import UUID

    from zerozero_api.domain.order import Order
    from zerozero_api.domain.user import User

__all__ = ["DeliveryPartner", "PartnerLocation"]


class DeliveryPartner(UUIDPk, TimestampMixin, Base):
    __tablename__ = "delivery_partners"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    vehicle: Mapped[VehicleType] = mapped_column(
        sa.Enum(VehicleType, name="vehicle_type"),
        nullable=False,
        default=VehicleType.BIKE,
        server_default=VehicleType.BIKE.value,
    )
    license_number: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    is_online: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=False, server_default=sa.false()
    )
    # Nullable FK — partner may be idle. ``use_alter=True`` breaks the
    # circular CREATE TABLE dependency with ``orders.partner_id``.
    current_order_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("orders.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
        index=True,
    )
    # Last known coordinate; updated opportunistically by the location
    # stream handler so quick lookups don't need to hit partner_locations.
    location: Mapped[WKBElement | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    user: Mapped[User] = relationship(back_populates="partner_profile", lazy="selectin")
    orders: Mapped[list[Order]] = relationship(
        back_populates="partner",
        foreign_keys="Order.partner_id",
        lazy="selectin",
    )
    locations: Mapped[list[PartnerLocation]] = relationship(
        back_populates="partner",
        cascade="all, delete-orphan",
        order_by=lambda: PartnerLocation.recorded_at.desc(),
        lazy="selectin",
    )


class PartnerLocation(UUIDPk, Base):
    __tablename__ = "partner_locations"

    partner_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("delivery_partners.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    location: Mapped[WKBElement] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=False,
    )
    speed_kmh: Mapped[float | None] = mapped_column(sa.Float(), nullable=True)
    heading: Mapped[float | None] = mapped_column(sa.Float(), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        index=True,
    )

    partner: Mapped[DeliveryPartner] = relationship(
        back_populates="locations", lazy="selectin"
    )

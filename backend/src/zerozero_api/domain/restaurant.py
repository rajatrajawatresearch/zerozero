"""Restaurant + restaurant-cuisine join table.

``Restaurant`` is the central product entity. It's owned by a user (the
"owner" role) and carries a geography point + a delivery radius in
meters; the hot-path query
`ST_DWithin(r.location, :point, r.delivery_radius_m)` drives the
"restaurants near me" list.

Cuisines are modeled as a proper many-to-many (``restaurant_cuisines``)
rather than a Postgres array so we can facet-search on cuisines without
custom operators.
"""

from __future__ import annotations

from uuid import UUID
from datetime import datetime

from datetime import time
from decimal import Decimal
from typing import TYPE_CHECKING

import sqlalchemy as sa
from geoalchemy2 import Geography, WKBElement
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from zerozero_api.domain.base import Base, TimestampMixin, UUIDPk

if TYPE_CHECKING:
    from uuid import UUID

    from zerozero_api.domain.cart import CartItem
    from zerozero_api.domain.cuisine import Cuisine
    from zerozero_api.domain.menu import MenuItem
    from zerozero_api.domain.order import Order
    from zerozero_api.domain.review import Review
    from zerozero_api.domain.user import User

__all__ = ["Restaurant", "RestaurantCuisine"]


class RestaurantCuisine(Base):
    """Association row linking restaurants ↔ cuisines (many-to-many)."""

    __tablename__ = "restaurant_cuisines"

    restaurant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("restaurants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    cuisine_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("cuisines.id", ondelete="CASCADE"),
        primary_key=True,
    )


class Restaurant(UUIDPk, TimestampMixin, Base):
    __tablename__ = "restaurants"

    # Owner is nullable: seeded/system-owned restaurants may not have a
    # human operator yet. When an owner deletes their account we null
    # the FK instead of cascading (historical orders must survive).
    owner_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(sa.String(160), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(sa.String(200), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)

    location: Mapped[WKBElement] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=False,
    )
    address_text: Mapped[str] = mapped_column(sa.String(512), nullable=False)
    delivery_radius_m: Mapped[int] = mapped_column(
        sa.Integer(), nullable=False, default=5000, server_default=sa.text("5000")
    )

    min_order: Mapped[Decimal] = mapped_column(
        sa.Numeric(12, 2), nullable=False, default=Decimal("0.00"), server_default=sa.text("0")
    )
    delivery_fee_base: Mapped[Decimal] = mapped_column(
        sa.Numeric(12, 2), nullable=False, default=Decimal("0.00"), server_default=sa.text("0")
    )
    avg_prep_minutes: Mapped[int] = mapped_column(
        sa.Integer(), nullable=False, default=20, server_default=sa.text("20")
    )

    rating_avg: Mapped[Decimal] = mapped_column(
        sa.Numeric(2, 1), nullable=False, default=Decimal("0.0"), server_default=sa.text("0")
    )
    rating_count: Mapped[int] = mapped_column(
        sa.Integer(), nullable=False, default=0, server_default=sa.text("0")
    )

    image_url: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    cover_url: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)

    opens_at: Mapped[time | None] = mapped_column(sa.Time(), nullable=True)
    closes_at: Mapped[time | None] = mapped_column(sa.Time(), nullable=True)

    is_active: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=True, server_default=sa.true()
    )
    is_featured: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=False, server_default=sa.false()
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    owner: Mapped[User | None] = relationship(
        back_populates="restaurants",
        foreign_keys=[owner_id],
        lazy="selectin",
    )
    cuisines: Mapped[list[Cuisine]] = relationship(
        secondary="restaurant_cuisines",
        back_populates="restaurants",
        lazy="selectin",
    )
    menu_items: Mapped[list[MenuItem]] = relationship(
        back_populates="restaurant",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    orders: Mapped[list[Order]] = relationship(
        back_populates="restaurant",
        lazy="selectin",
    )
    cart_items: Mapped[list[CartItem]] = relationship(
        back_populates="restaurant",
        lazy="selectin",
    )
    reviews: Mapped[list[Review]] = relationship(
        back_populates="restaurant",
        lazy="selectin",
    )

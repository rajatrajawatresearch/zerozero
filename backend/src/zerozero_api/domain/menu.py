"""Menu items — the orderable units on a restaurant page.

``variants`` is JSONB so we can model arbitrary option trees (size,
spice, add-ons) without a second table. ``tags`` is a Postgres TEXT
array because the set is small and chip-rendered client-side.
"""

from __future__ import annotations

from uuid import UUID
from datetime import datetime

from decimal import Decimal
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from zerozero_api.domain.base import Base, TimestampMixin, UUIDPk

if TYPE_CHECKING:
    from uuid import UUID

    from zerozero_api.domain.cart import CartItem
    from zerozero_api.domain.category import Category
    from zerozero_api.domain.order import OrderItem
    from zerozero_api.domain.restaurant import Restaurant

__all__ = ["MenuItem"]


class MenuItem(UUIDPk, TimestampMixin, Base):
    __tablename__ = "menu_items"

    restaurant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("restaurants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(sa.String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    price: Mapped[Decimal] = mapped_column(
        sa.Numeric(12, 2), nullable=False, default=Decimal("0.00")
    )
    image_url: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    is_veg: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=True, server_default=sa.true()
    )
    is_available: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=True, server_default=sa.true()
    )
    tags: Mapped[list[str]] = mapped_column(
        sa.ARRAY(sa.String(64)),
        nullable=False,
        default=list,
        server_default=sa.text("ARRAY[]::varchar[]"),
    )
    variants: Mapped[dict[str, Any]] = mapped_column(
        JSONB(), nullable=False, default=dict, server_default=sa.text("'{}'::jsonb")
    )
    sort_order: Mapped[int] = mapped_column(
        sa.Integer(), nullable=False, default=0, server_default=sa.text("0")
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    restaurant: Mapped[Restaurant] = relationship(
        back_populates="menu_items", lazy="selectin"
    )
    category: Mapped[Category | None] = relationship(
        back_populates="menu_items", lazy="selectin"
    )
    cart_items: Mapped[list[CartItem]] = relationship(
        back_populates="menu_item",
        lazy="selectin",
    )
    order_items: Mapped[list[OrderItem]] = relationship(
        back_populates="menu_item",
        lazy="selectin",
    )

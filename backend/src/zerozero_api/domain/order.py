"""Order aggregate: ``orders``, ``order_items``, ``order_status_events``.

Snapshots of ``name`` / ``price`` are copied onto ``order_items`` at
checkout so a later menu-edit doesn't rewrite history. ``share_token``
is a random URL-safe string for the public tracking page.
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
from zerozero_api.domain.enums import (
    ActorType,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
)

if TYPE_CHECKING:
    from uuid import UUID

    from zerozero_api.domain.address import Address
    from zerozero_api.domain.menu import MenuItem
    from zerozero_api.domain.partner import DeliveryPartner
    from zerozero_api.domain.restaurant import Restaurant
    from zerozero_api.domain.review import Review
    from zerozero_api.domain.user import User

__all__ = ["Order", "OrderItem", "OrderStatusEvent"]


class Order(UUIDPk, TimestampMixin, Base):
    __tablename__ = "orders"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    restaurant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("restaurants.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    address_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("addresses.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    partner_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("delivery_partners.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    status: Mapped[OrderStatus] = mapped_column(
        sa.Enum(OrderStatus, name="order_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=OrderStatus.PLACED,
        server_default=OrderStatus.PLACED.value,
        index=True,
    )

    subtotal: Mapped[Decimal] = mapped_column(
        sa.Numeric(12, 2), nullable=False, default=Decimal("0.00")
    )
    discount: Mapped[Decimal] = mapped_column(
        sa.Numeric(12, 2), nullable=False, default=Decimal("0.00"), server_default=sa.text("0")
    )
    delivery_fee: Mapped[Decimal] = mapped_column(
        sa.Numeric(12, 2), nullable=False, default=Decimal("0.00"), server_default=sa.text("0")
    )
    tax: Mapped[Decimal] = mapped_column(
        sa.Numeric(12, 2), nullable=False, default=Decimal("0.00"), server_default=sa.text("0")
    )
    total: Mapped[Decimal] = mapped_column(
        sa.Numeric(12, 2), nullable=False, default=Decimal("0.00")
    )

    payment_method: Mapped[PaymentMethod] = mapped_column(
        sa.Enum(PaymentMethod, name="payment_method", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=PaymentMethod.COD,
        server_default=PaymentMethod.COD.value,
    )
    payment_status: Mapped[PaymentStatus] = mapped_column(
        sa.Enum(PaymentStatus, name="payment_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=PaymentStatus.PENDING,
        server_default=PaymentStatus.PENDING.value,
    )
    promo_code: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)

    placed_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    delivered_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    share_token: Mapped[str] = mapped_column(
        sa.String(64), nullable=False, unique=True, index=True
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    user: Mapped[User] = relationship(
        back_populates="orders",
        foreign_keys=[user_id],
        lazy="selectin",
    )
    restaurant: Mapped[Restaurant] = relationship(
        back_populates="orders", lazy="selectin"
    )
    address: Mapped[Address] = relationship(back_populates="orders", lazy="selectin")
    partner: Mapped[DeliveryPartner | None] = relationship(
        back_populates="orders",
        foreign_keys=[partner_id],
        lazy="selectin",
    )
    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    status_events: Mapped[list[OrderStatusEvent]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderStatusEvent.created_at",
        lazy="selectin",
    )
    review: Mapped[Review | None] = relationship(
        back_populates="order",
        uselist=False,
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class OrderItem(UUIDPk, Base):
    __tablename__ = "order_items"

    order_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    menu_item_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("menu_items.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name_snapshot: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    price_snapshot: Mapped[Decimal] = mapped_column(sa.Numeric(12, 2), nullable=False)
    qty: Mapped[int] = mapped_column(
        sa.Integer(), nullable=False, default=1, server_default=sa.text("1")
    )
    options: Mapped[dict[str, Any]] = mapped_column(
        JSONB(), nullable=False, default=dict, server_default=sa.text("'{}'::jsonb")
    )

    order: Mapped[Order] = relationship(back_populates="items", lazy="selectin")
    menu_item: Mapped[MenuItem | None] = relationship(
        back_populates="order_items", lazy="selectin"
    )


class OrderStatusEvent(UUIDPk, Base):
    __tablename__ = "order_status_events"

    order_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[OrderStatus] = mapped_column(
        sa.Enum(OrderStatus, name="order_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    note: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    actor_type: Mapped[ActorType] = mapped_column(
        sa.Enum(ActorType, name="actor_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=ActorType.SYSTEM,
        server_default=ActorType.SYSTEM.value,
    )
    actor_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        index=True,
    )

    order: Mapped[Order] = relationship(back_populates="status_events", lazy="selectin")

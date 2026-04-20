"""User account model.

This is the root entity everything else links to:
  - ``addresses`` (one-to-many, user-owned delivery locations)
  - ``cart_items`` (one-to-many, the current cart)
  - ``orders`` (one-to-many, order history)
  - ``restaurants`` (one-to-many as owner, via ``Restaurant.owner_id``)
  - ``delivery_partner`` (one-to-one when role=partner)
  - ``reviews``, ``notifications``, ``refresh_tokens``, ``theme_presets``

The ``email`` column uses ``CITEXT`` so lookups are case-insensitive without
touching functional indexes (CITEXT compares case-insensitively out of
the box; Postgres still stores the original casing for display).
"""

from __future__ import annotations

from uuid import UUID
from datetime import datetime

from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from zerozero_api.domain.base import Base, TimestampMixin, UUIDPk
from zerozero_api.domain.enums import UserRole

if TYPE_CHECKING:
    from zerozero_api.domain.address import Address
    from zerozero_api.domain.cart import CartItem
    from zerozero_api.domain.notification import Notification
    from zerozero_api.domain.order import Order
    from zerozero_api.domain.partner import DeliveryPartner
    from zerozero_api.domain.restaurant import Restaurant
    from zerozero_api.domain.review import Review
    from zerozero_api.domain.theme import ThemePreset
    from zerozero_api.domain.refresh_token import RefreshToken

__all__ = ["User", "UserRole"]


class User(UUIDPk, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(CITEXT(), nullable=False, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(sa.String(32), nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        sa.Enum(UserRole, name="user_role"),
        nullable=False,
        default=UserRole.CUSTOMER,
        server_default=UserRole.CUSTOMER.value,
    )
    avatar_url: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    email_verified: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=False, server_default=sa.false()
    )
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=True, server_default=sa.true()
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    addresses: Mapped[list[Address]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    cart_items: Mapped[list[CartItem]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    orders: Mapped[list[Order]] = relationship(
        back_populates="user",
        foreign_keys="Order.user_id",
        lazy="selectin",
    )
    restaurants: Mapped[list[Restaurant]] = relationship(
        back_populates="owner",
        foreign_keys="Restaurant.owner_id",
        lazy="selectin",
    )
    partner_profile: Mapped[DeliveryPartner | None] = relationship(
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    reviews: Mapped[list[Review]] = relationship(
        back_populates="user",
        lazy="selectin",
    )
    notifications: Mapped[list[Notification]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    refresh_tokens: Mapped[list[RefreshToken]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    theme_presets: Mapped[list[ThemePreset]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

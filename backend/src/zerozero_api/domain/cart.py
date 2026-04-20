"""Server-side cart items.

The cart lives on the server so it survives device/browser switches.
``options_hash`` is a deterministic digest of ``options`` used to enforce
a unique ``(user_id, menu_item_id, options_hash)`` constraint — picking
the "same" item with different add-ons stays as two distinct rows; the
"same" item with identical add-ons merges into one row.
"""

from __future__ import annotations

from uuid import UUID
from datetime import datetime

from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from zerozero_api.domain.base import Base, TimestampMixin, UUIDPk

if TYPE_CHECKING:
    from uuid import UUID

    from zerozero_api.domain.menu import MenuItem
    from zerozero_api.domain.restaurant import Restaurant
    from zerozero_api.domain.user import User

__all__ = ["CartItem"]


class CartItem(UUIDPk, TimestampMixin, Base):
    __tablename__ = "cart_items"
    __table_args__ = (
        sa.UniqueConstraint(
            "user_id", "menu_item_id", "options_hash",
            name="uq_cart_items_user_id_menu_item_id_options_hash",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    restaurant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("restaurants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    menu_item_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("menu_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    qty: Mapped[int] = mapped_column(
        sa.Integer(), nullable=False, default=1, server_default=sa.text("1")
    )
    options: Mapped[dict[str, Any]] = mapped_column(
        JSONB(), nullable=False, default=dict, server_default=sa.text("'{}'::jsonb")
    )
    # sha256 of the canonicalised `options` payload. Computed by the
    # service layer before insert/update (NOT a generated column so we can
    # keep the hash stable as Python code evolves).
    options_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    user: Mapped[User] = relationship(back_populates="cart_items", lazy="selectin")
    restaurant: Mapped[Restaurant] = relationship(
        back_populates="cart_items", lazy="selectin"
    )
    menu_item: Mapped[MenuItem] = relationship(
        back_populates="cart_items", lazy="selectin"
    )

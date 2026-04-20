"""Customer review attached to a delivered order.

One review per order is enforced by the unique constraint on
``order_id``. ``images`` is a small text array of uploaded image URLs.
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
    from datetime import datetime
    from uuid import UUID

    from zerozero_api.domain.order import Order
    from zerozero_api.domain.restaurant import Restaurant
    from zerozero_api.domain.user import User

__all__ = ["Review"]


class Review(UUIDPk, Base):
    __tablename__ = "reviews"
    __table_args__ = (
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
    )

    order_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        sa.ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
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
    rating: Mapped[int] = mapped_column(sa.SmallInteger(), nullable=False)
    comment: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    images: Mapped[list[str]] = mapped_column(
        sa.ARRAY(sa.String(512)),
        nullable=False,
        default=list,
        server_default=sa.text("ARRAY[]::varchar[]"),
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )

    order: Mapped[Order] = relationship(back_populates="review", lazy="selectin")
    user: Mapped[User] = relationship(back_populates="reviews", lazy="selectin")
    restaurant: Mapped[Restaurant] = relationship(
        back_populates="reviews", lazy="selectin"
    )

"""Promo codes applied at checkout.

Amount semantics:
  - ``discount_type = FLAT``    → ``value`` is flat INR (or currency) amount
  - ``discount_type = PERCENT`` → ``value`` is integer-ish (10 = 10%); the
    service layer still caps the applied discount at ``max_discount``.
"""

from __future__ import annotations

from uuid import UUID

from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from zerozero_api.domain.base import Base, TimestampMixin, UUIDPk
from zerozero_api.domain.enums import DiscountType

__all__ = ["PromoCode"]


class PromoCode(UUIDPk, TimestampMixin, Base):
    __tablename__ = "promo_codes"

    code: Mapped[str] = mapped_column(sa.String(64), nullable=False, unique=True, index=True)
    discount_type: Mapped[DiscountType] = mapped_column(
        sa.Enum(DiscountType, name="discount_type"),
        nullable=False,
    )
    value: Mapped[Decimal] = mapped_column(sa.Numeric(12, 2), nullable=False)
    min_order: Mapped[Decimal] = mapped_column(
        sa.Numeric(12, 2), nullable=False, default=Decimal("0.00"), server_default=sa.text("0")
    )
    max_discount: Mapped[Decimal | None] = mapped_column(sa.Numeric(12, 2), nullable=True)
    valid_from: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    valid_to: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    usage_limit: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    used_count: Mapped[int] = mapped_column(
        sa.Integer(), nullable=False, default=0, server_default=sa.text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=True, server_default=sa.true()
    )

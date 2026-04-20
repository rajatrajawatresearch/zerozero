"""Top-level menu/restaurant categories (Biryani, Pizza, Desserts, ...).

Distinct from cuisines: a category is a *dish-type* bucket used on the
homepage rails ("Explore by category"), whereas a cuisine is a regional
style. Menu items link to a category via ``menu_items.category_id``.
"""

from __future__ import annotations

from uuid import UUID
from datetime import datetime

from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from zerozero_api.domain.base import Base, TimestampMixin, UUIDPk

if TYPE_CHECKING:
    from zerozero_api.domain.menu import MenuItem

__all__ = ["Category"]


class Category(UUIDPk, TimestampMixin, Base):
    __tablename__ = "categories"

    name: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    slug: Mapped[str] = mapped_column(sa.String(80), nullable=False, unique=True, index=True)
    icon: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    sort_order: Mapped[int] = mapped_column(
        sa.Integer(), nullable=False, default=0, server_default=sa.text("0")
    )

    menu_items: Mapped[list[MenuItem]] = relationship(
        back_populates="category",
        lazy="selectin",
    )

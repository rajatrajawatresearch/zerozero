"""Menu-item + grouped-menu response schemas.

Two-layer shape:

1. :class:`MenuItemOut` — flat projection of a single ``menu_items`` row.
   ``price`` is :class:`~decimal.Decimal` (source of truth = ``Numeric(12,2)``
   column) and serialized as a **string** to avoid JS float-loss on the
   wire (e.g. ``"199.00"``, not ``199.0``).

2. :class:`MenuCategory` + :class:`RestaurantMenu` — the grouped view
   returned by ``GET /restaurants/{slug}/menu``: one section per
   category, each carrying its items, both ordered by ``sort_order``
   server-side so the frontend can render straight through.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from zerozero_api.schemas.category import CategoryOut

__all__ = ["MenuItemOut", "MenuCategory", "RestaurantMenu"]


class MenuItemOut(BaseModel):
    """Public projection of a :class:`MenuItem` row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Menu item UUID.")
    category_id: UUID | None = Field(
        default=None,
        description="FK to categories.id. Nullable because a category can be deleted.",
    )
    name: str = Field(..., description="Item name shown in the menu.")
    description: str | None = Field(default=None, description="Long-form description.")
    price: Decimal = Field(
        ...,
        description="Unit price in the restaurant's currency. Serialized as a string decimal.",
    )
    image_url: str | None = Field(default=None, description="Optional item thumbnail URL.")
    is_veg: bool = Field(..., description="Strict-veg flag (green dot marker in UI).")
    is_available: bool = Field(
        ..., description="Whether the item is currently orderable."
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Free-form tag chips: 'bestseller', 'spicy', 'new', etc.",
    )
    variants: list[dict[str, Any]] | None = Field(
        default=None,
        description=(
            "Optional variant tree. JSONB on the DB side — arbitrary shape "
            "(size / add-on groups) negotiated per restaurant."
        ),
    )

    # Money on the wire = string. Avoids float-rounding downstream.
    @field_serializer("price")
    def _serialize_price(self, value: Decimal) -> str:
        return str(value)

    # The DB column is JSONB (``dict`` on the Python side), but the contract
    # ships ``list[dict] | None``. Normalize at serialization time so callers
    # don't need to know the storage detail.
    @field_serializer("variants", when_used="unless-none")
    def _serialize_variants(self, value: Any) -> list[dict[str, Any]] | None:
        if value is None:
            return None
        # A populated ``{}`` means "no variants defined" — normalize to None
        # so the frontend can do a simple truthy check.
        if isinstance(value, dict):
            if not value:
                return None
            # Some restaurants may store as ``{"groups": [...]}``. If the dict
            # already contains a ``groups`` list, flatten; otherwise wrap.
            groups = value.get("groups")
            if isinstance(groups, list):
                return [g for g in groups if isinstance(g, dict)]
            return [value]
        if isinstance(value, list):
            return [v for v in value if isinstance(v, dict)]
        return None


class MenuCategory(BaseModel):
    """One grouped section on a restaurant's menu page."""

    model_config = ConfigDict(from_attributes=True)

    category: CategoryOut = Field(..., description="Category metadata for this section.")
    items: list[MenuItemOut] = Field(
        default_factory=list,
        description="Items in this category, ordered by ``sort_order`` asc, then name.",
    )


class RestaurantMenu(BaseModel):
    """Grouped menu response for ``GET /restaurants/{slug}/menu``."""

    model_config = ConfigDict(from_attributes=True)

    restaurant_id: UUID = Field(..., description="Owning restaurant UUID.")
    categories: list[MenuCategory] = Field(
        default_factory=list,
        description="Categories in display order (``Category.sort_order`` asc).",
    )

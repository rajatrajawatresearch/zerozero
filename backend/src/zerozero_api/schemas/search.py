"""Unified search response schemas.

The ``GET /search`` endpoint returns two parallel result buckets:

  - ``restaurants`` — full :class:`RestaurantCard` payloads reused from
    the discovery endpoint so the frontend can render hits with the
    exact same card component.
  - ``menu_items``  — lightweight :class:`MenuItemSearchHit` rows. Each
    hit carries a denormalized :class:`RestaurantBrief` so the UI can
    link the item back to its restaurant without a second round-trip.

Money (``price``) is :class:`~decimal.Decimal` in memory and serialized
as **string** on the wire, consistent with the rest of the contract
(``rating_avg``, ``min_order``, etc.).
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from zerozero_api.schemas.restaurant import RestaurantCard

__all__ = ["RestaurantBrief", "MenuItemSearchHit", "SearchResults"]


class RestaurantBrief(BaseModel):
    """Compact restaurant reference embedded in a menu-item search hit.

    Only the fields the search-result UI needs to render a "from Restaurant X"
    subtitle + a click-through link. A full :class:`RestaurantCard` would be
    overkill for 15 menu hits on a single page.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Restaurant UUID.")
    name: str = Field(..., description="Restaurant display name.")
    slug: str = Field(..., description="URL-friendly slug (unique).")
    image_url: str | None = Field(
        default=None, description="Square/logo image URL for the card thumb."
    )


class MenuItemSearchHit(BaseModel):
    """Single menu-item result in the unified search response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Menu item UUID.")
    name: str = Field(..., description="Item name shown in the hit row.")
    price: Decimal = Field(
        ...,
        description="Unit price in the restaurant's currency. Serialized as a string decimal.",
    )
    image_url: str | None = Field(default=None, description="Optional item thumbnail URL.")
    is_veg: bool = Field(..., description="Strict-veg flag (green dot marker in UI).")
    restaurant: RestaurantBrief = Field(
        ..., description="Denormalized owning-restaurant reference for click-through."
    )

    @field_serializer("price")
    def _serialize_price(self, value: Decimal) -> str:
        return str(value)


class SearchResults(BaseModel):
    """Unified search response with parallel restaurant / menu-item buckets."""

    model_config = ConfigDict(from_attributes=True)

    restaurants: list[RestaurantCard] = Field(
        default_factory=list,
        description="Top restaurant matches, ranked by pg_trgm similarity (max 10).",
    )
    menu_items: list[MenuItemSearchHit] = Field(
        default_factory=list,
        description="Top menu-item matches across all active restaurants (max 15).",
    )

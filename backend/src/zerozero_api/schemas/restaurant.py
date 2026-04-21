"""Restaurant response schemas — cards (list), detail, and the menu view.

Two-tier projection:

  - :class:`RestaurantCard`  — compact tile used by the homepage grid,
    search results, and filter rails. Includes the *computed* fields
    (``distance_km``, ``delivers_here``, ``is_open``) assembled in the
    service layer.
  - :class:`RestaurantDetail` — extends ``RestaurantCard`` with
    description, cover image, opening hours, and geo point. Returned by
    ``GET /restaurants/{slug}``.

Money (``rating_avg``, ``min_order``, ``delivery_fee_base``) is always
:class:`~decimal.Decimal` in memory and serialized as **string** on the
wire to prevent JavaScript float-loss downstream.

The service layer constructs these models via ``RestaurantCard(...)``
(**not** ``from_attributes=True``) because several fields are derived
at query time (``distance_km`` from ``ST_Distance``, ``is_open`` from
the current UTC wall clock). ``from_attributes=True`` is kept enabled so
ad-hoc conversions still work for tests.
"""

from __future__ import annotations

from datetime import time
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from zerozero_api.schemas.cuisine import CuisineOut

__all__ = ["RestaurantCard", "RestaurantDetail"]


class RestaurantCard(BaseModel):
    """Compact restaurant tile used by list / search endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Restaurant UUID.")
    slug: str = Field(..., description="URL-friendly slug (unique).")
    name: str = Field(..., description="Restaurant display name.")
    cover_url: str | None = Field(
        default=None, description="Wide cover image URL for cards/hero."
    )
    cuisines: list[CuisineOut] = Field(
        default_factory=list,
        description="All cuisines tagged to this restaurant.",
    )
    rating_avg: Decimal = Field(
        ...,
        description="Arithmetic mean of review ratings (0.0 - 5.0). String on the wire.",
    )
    rating_count: int = Field(..., ge=0, description="Number of reviews used for ``rating_avg``.")
    avg_prep_minutes: int = Field(
        ..., ge=0, description="Average kitchen prep time in minutes."
    )
    distance_km: float | None = Field(
        default=None,
        description=(
            "Straight-line distance from the query point. ``null`` when the caller "
            "didn't pass ``lat`` / ``lng``."
        ),
    )
    delivers_here: bool = Field(
        default=False,
        description=(
            "Whether the restaurant delivers to the query point (distance <= "
            "``delivery_radius_m``). False when no ``lat`` / ``lng`` was passed."
        ),
    )
    is_open: bool = Field(
        ...,
        description=(
            "Computed server-side from the current UTC time versus "
            "``opens_at`` / ``closes_at``."
        ),
    )
    min_order: Decimal = Field(
        ..., description="Minimum order subtotal. String on the wire."
    )
    delivery_fee_base: Decimal = Field(
        ..., description="Flat base delivery fee. String on the wire."
    )

    @field_serializer("rating_avg", "min_order", "delivery_fee_base")
    def _serialize_money(self, value: Decimal) -> str:
        return str(value)


class RestaurantDetail(RestaurantCard):
    """Full restaurant detail page payload (``GET /restaurants/{slug}``)."""

    description: str | None = Field(
        default=None, description="Long-form marketing blurb."
    )
    image_url: str | None = Field(default=None, description="Square/logo image URL.")
    address_text: str = Field(..., description="Human-readable street address.")
    lat: float = Field(..., ge=-90, le=90, description="Location latitude.")
    lng: float = Field(..., ge=-180, le=180, description="Location longitude.")
    opens_at: time = Field(..., description="Daily opening time (UTC wall clock).")
    closes_at: time = Field(
        ...,
        description=(
            "Daily closing time. When ``closes_at <= opens_at`` the window "
            "is interpreted as crossing midnight."
        ),
    )
    is_featured: bool = Field(
        ..., description="Marketing flag — featured restaurants get the top rail."
    )

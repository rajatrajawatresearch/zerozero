"""Cuisine response schema.

A cuisine is a regional style tag attached to a restaurant via the
``restaurant_cuisines`` many-to-many. The payload is tiny and read-only
for the public API; it's shipped both on its own (``GET /cuisines``) and
embedded inside ``RestaurantCard`` / ``RestaurantDetail`` responses.

The shape mirrors :class:`zerozero_api.domain.cuisine.Cuisine` 1:1, so
we rely on ``from_attributes=True`` to populate directly from the ORM
row without an explicit mapper.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

__all__ = ["CuisineOut"]


class CuisineOut(BaseModel):
    """Public projection of a :class:`Cuisine` row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Cuisine UUID.")
    name: str = Field(..., description="Human-readable cuisine name, e.g. 'North Indian'.")
    slug: str = Field(..., description="URL-friendly slug, e.g. 'north-indian'.")
    icon: str | None = Field(default=None, description="Optional icon URL or emoji.")
    is_veg_only: bool = Field(
        ..., description="Whether this cuisine exclusively covers vegetarian fare."
    )

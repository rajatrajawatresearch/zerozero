"""Menu-category response schema.

A ``Category`` is a dish-type bucket ("Biryani", "Pizza", "Desserts")
used both on the homepage rails ("Explore by category") and to group
menu items within a restaurant's menu. Unlike cuisines, categories live
at the *item* granularity.

Shape is read-only and flat; we lean on ``from_attributes=True`` to
populate straight from the ORM row.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

__all__ = ["CategoryOut"]


class CategoryOut(BaseModel):
    """Public projection of a :class:`Category` row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Category UUID.")
    name: str = Field(..., description="Human-readable category name.")
    slug: str = Field(..., description="URL-friendly slug.")
    icon: str | None = Field(default=None, description="Optional icon URL or emoji.")
    sort_order: int = Field(
        ...,
        description="Display order — lower sorts first on rails and menu pages.",
    )

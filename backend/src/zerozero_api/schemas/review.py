"""Review schemas — create DTO + response projection.

One review per *delivered* order (enforced by unique constraint on
``reviews.order_id`` plus the ``status=delivered`` gate in the service).
Rating is a 1-5 integer; images are URLs already uploaded via the
``/uploads`` endpoint (owner: Agent 3, Phase 2).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.types import conint

__all__ = ["ReviewCreateIn", "ReviewOut"]


class ReviewCreateIn(BaseModel):
    """Payload for ``POST /orders/{id}/review``.

    ``rating`` is a 1-5 integer (matches the DB CHECK constraint).
    ``images`` is a capped list of already-uploaded URLs; we keep the
    cap small so review payloads stay small.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    rating: conint(ge=1, le=5) = Field(  # type: ignore[valid-type]
        ..., description="Star rating 1-5."
    )
    comment: str | None = Field(
        default=None,
        max_length=2000,
        description="Optional free-form review body.",
    )
    images: list[str] = Field(
        default_factory=list,
        max_length=8,
        description="Pre-uploaded image URLs attached to the review.",
    )


class ReviewOut(BaseModel):
    """Projection of a ``reviews`` row returned after creation."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Review UUID.")
    order_id: UUID = Field(..., description="Order this review is attached to.")
    user_id: UUID = Field(..., description="Author's UUID (the order's customer).")
    restaurant_id: UUID = Field(
        ..., description="Owning restaurant — denormalized for faster reads."
    )
    rating: int = Field(..., ge=1, le=5, description="Star rating 1-5.")
    comment: str | None = Field(default=None, description="Optional review body.")
    images: list[str] = Field(
        default_factory=list, description="Uploaded image URLs attached to the review."
    )
    created_at: datetime = Field(..., description="Server-side creation time (UTC).")

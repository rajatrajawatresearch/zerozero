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

__all__ = ["ReviewCreateIn", "ReviewListItem", "ReviewOut", "ReviewWithUser"]


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


class ReviewListItem(BaseModel):
    """Public list row for the restaurant-detail reviews section.

    Joins :class:`~zerozero_api.domain.user.User` so each card can show the
    reviewer's display name + avatar without a second round-trip. The
    ``user_id`` is deliberately omitted — clients only need the rendered
    identity, not the UUID.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Review UUID.")
    rating: int = Field(..., ge=1, le=5, description="Star rating 1-5.")
    comment: str | None = Field(default=None, description="Optional review body.")
    images: list[str] = Field(
        default_factory=list,
        description="Uploaded image URLs attached to the review.",
    )
    created_at: datetime = Field(..., description="Server-side creation time (UTC).")
    user_full_name: str = Field(..., description="Reviewer's display name.")
    user_avatar_url: str | None = Field(
        default=None, description="Reviewer's avatar URL, if any."
    )


class ReviewWithUser(ReviewOut):
    """``ReviewOut`` enriched with the reviewer's public profile bits.

    Useful when the caller already has a specific review UUID (e.g. the
    owner responding to a complaint) and wants the full payload plus the
    reviewer's display name / avatar in one go. Keeps ``ReviewOut`` lean
    for the hot-path create response.
    """

    user_full_name: str = Field(..., description="Reviewer's display name.")
    user_avatar_url: str | None = Field(
        default=None, description="Reviewer's avatar URL, if any."
    )

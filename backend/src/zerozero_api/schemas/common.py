"""Shared response envelopes: pagination and error shape.

Both are consumed by every agent's router, so they live in a neutral
module that doesn't import from any feature-specific schema.

``PageOut[T]`` matches the Phase 2 contract pagination shape used by
restaurants, orders, search, etc. ``ErrorOut`` mirrors the JSON envelope
produced by ``core.errors.register_exception_handlers`` so the OpenAPI
schema accurately documents error responses.
"""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

__all__ = ["ErrorOut", "ErrorPayload", "PageOut"]


T = TypeVar("T")


class PageOut(BaseModel, Generic[T]):
    """Generic page envelope for list endpoints.

    Matches the contract in ``docs/PHASE2_CONTRACTS.md`` — items plus
    pagination metadata. ``has_next`` is derived from ``page*page_size <
    total`` so the frontend can paginate without additional round trips.
    """

    model_config = ConfigDict(from_attributes=True)

    items: list[T]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=200)
    total: int = Field(ge=0)
    has_next: bool


class ErrorPayload(BaseModel):
    """Inner ``error`` object used by ``core.errors``."""

    code: str
    detail: str
    request_id: str = ""
    # Catch-all for enriched error variants (validation errors carry
    # ``errors: list[{loc, msg, type}]``; domain errors may attach a
    # ``field``). Kept open so routers don't need bespoke subclasses.
    extra: dict[str, Any] | None = None


class ErrorOut(BaseModel):
    """Top-level error envelope: ``{"error": {...}}``.

    Declared as a ``response_model`` candidate for documenting non-200
    responses. Endpoints don't construct this directly — ``core.errors``
    builds it at serialization time.
    """

    error: ErrorPayload

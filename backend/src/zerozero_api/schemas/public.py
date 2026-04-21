"""Public tracking schemas (Phase 4).

The public share-token tracking page must not leak PII. We reuse the
status-event and partner-location shapes from the order track payload,
but strip anything that could identify the customer:

  * **No** customer name, email, phone
  * **No** full street address (line1/line2)
  * **Only** city + a truncated label (e.g. "Home (near Indiranagar)")
  * Restaurant name is public anyway — kept for UI context.

Contract reference: ``docs/PHASE4_CONTRACTS.md`` → "public:{share_token}"
channel fans out the same events as ``orders:{id}``, minus PII.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from zerozero_api.domain.enums import OrderStatus
from zerozero_api.schemas.order import OrderStatusEventOut

__all__ = ["PublicTrackOut", "SanitizedAddress"]


class SanitizedAddress(BaseModel):
    """PII-stripped address projection for the public tracker.

    Only the destination city and a truncated label make it to the wire.
    The label is intentionally soft-limited so we never echo full house
    numbers even when a customer typed them into their saved label.
    """

    model_config = ConfigDict(extra="forbid")

    city: str = Field(..., description="Destination city (public).")
    label: str | None = Field(
        default=None,
        max_length=48,
        description=(
            "Truncated, PII-free address label (e.g. 'Home', 'Office'). "
            "Never includes house number or line1/line2."
        ),
    )


class PublicTrackOut(BaseModel):
    """Payload for ``GET /public/track/{share_token}`` + the public WS snapshot.

    Mirrors :class:`OrderTrackOut` shape but omits the full address and any
    customer identifiers. The frontend uses this in:

      - The share-link landing page (unauthenticated visitors)
      - The ``/ws/public/track/{share_token}`` initial snapshot
    """

    model_config = ConfigDict(extra="forbid")

    status: OrderStatus = Field(..., description="Current order status.")
    events: list[OrderStatusEventOut] = Field(
        default_factory=list,
        description="Oldest-first transition log.",
    )
    partner_location: dict[str, float] | None = Field(
        default=None,
        description=(
            "Latest delivery-partner ping as ``{lat, lng}``. Null when no "
            "partner has been assigned or no ping has been received."
        ),
    )
    restaurant_name: str = Field(
        ..., description="Owning restaurant name (public)."
    )
    destination: SanitizedAddress = Field(
        ...,
        description="Sanitized drop-off (city + truncated label, no street).",
    )
    eta_minutes: int | None = Field(
        default=None,
        description="Best-effort remaining ETA in minutes. Null when unknown.",
    )

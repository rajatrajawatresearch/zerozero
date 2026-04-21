"""Delivery-partner Pydantic schemas (Phase 4).

Contract lives in ``docs/PHASE4_CONTRACTS.md`` → "Partner simulator route".

Four wire shapes:
  * :class:`PartnerOnlineIn`        — go online + initial coordinate.
  * :class:`PartnerLocationBatchIn` — batched GPS pings from the device.
  * :class:`PartnerAcceptOrderOut`  — response of accept-order that carries
    the pickup/drop coordinates the client needs to draw the route.
  * :class:`PartnerStatusUpdateIn`  — advance-status call (confirmed →
    preparing → ready → out_for_delivery → delivered).

A tiny :class:`LatLng` helper is defined here (not in ``schemas.geo``)
because it's partner-owned and we don't want to bloat ``geo``.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from zerozero_api.domain.enums import OrderStatus, VehicleType

__all__ = [
    "LatLng",
    "PartnerAcceptOrderOut",
    "PartnerLocationBatchIn",
    "PartnerLocationPoint",
    "PartnerOnlineIn",
    "PartnerStatusUpdateIn",
]


class LatLng(BaseModel):
    """Compact ``{lat, lng}`` pair used by assignment + accept payloads."""

    model_config = ConfigDict(extra="forbid")

    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitude in WGS84 degrees.")
    lng: float = Field(..., ge=-180.0, le=180.0, description="Longitude in WGS84 degrees.")


class PartnerOnlineIn(BaseModel):
    """Payload for ``POST /partner/online`` — set is_online + current location."""

    model_config = ConfigDict(extra="forbid")

    lat: float = Field(..., ge=-90.0, le=90.0, description="Current latitude.")
    lng: float = Field(..., ge=-180.0, le=180.0, description="Current longitude.")
    vehicle: VehicleType | None = Field(
        default=None,
        description=(
            "Optional vehicle override. When set, updates the partner's "
            "``vehicle`` column; otherwise the existing value is kept."
        ),
    )


class PartnerLocationPoint(BaseModel):
    """One GPS ping in a batch upload.

    ``recorded_at`` is the device-side timestamp; we trust it for ordering
    but clamp ``speed_kmh`` / ``heading`` at the DB layer.
    """

    model_config = ConfigDict(extra="forbid")

    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    recorded_at: datetime = Field(
        ..., description="Device-side capture time (UTC, tz-aware)."
    )
    speed: float | None = Field(
        default=None, ge=0.0, description="Speed in km/h (optional)."
    )
    heading: float | None = Field(
        default=None,
        ge=0.0,
        le=360.0,
        description="Compass heading 0-360° (optional).",
    )


class PartnerLocationBatchIn(BaseModel):
    """Payload for ``POST /partner/location`` — batch of pings."""

    model_config = ConfigDict(extra="forbid")

    points: list[PartnerLocationPoint] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="1-100 GPS points ordered oldest-first.",
    )


class PartnerAcceptOrderOut(BaseModel):
    """Response of ``POST /partner/orders/{id}/accept``.

    Carries the pickup (restaurant) and drop (customer) coordinates so
    the partner app can immediately render the route polyline.
    """

    model_config = ConfigDict(from_attributes=True)

    order_id: UUID = Field(..., description="Accepted order UUID.")
    pickup: LatLng = Field(..., description="Restaurant coordinates.")
    drop: LatLng = Field(..., description="Customer delivery coordinates.")


class PartnerStatusUpdateIn(BaseModel):
    """Payload for ``POST /partner/orders/{id}/status`` — advance status."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    status: OrderStatus = Field(
        ...,
        description=(
            "Target status. Must be a valid forward transition from the "
            "order's current state."
        ),
    )
    note: str | None = Field(
        default=None,
        max_length=512,
        description="Optional free-form note stored alongside the event.",
    )

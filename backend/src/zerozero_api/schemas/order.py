"""Order request / response schemas.

Implements the ``/orders`` contract in ``docs/PHASE3_CONTRACTS.md``:
checkout payload (:class:`CheckoutIn`), list-tile (:class:`OrderListItem`),
full detail (:class:`OrderDetailOut`), line item (:class:`OrderItemOut`),
status-event (:class:`OrderStatusEventOut`), and the lightweight
polling/track payload (:class:`OrderTrackOut`).

Conventions
-----------
* Money values are :class:`~decimal.Decimal` internally (source of truth
  = ``Numeric(12, 2)``) and serialize to **strings** on the wire to avoid
  JS float loss.
* ``short_id`` = ``str(order.id)[-8:].upper()`` — a user-facing handle
  computed at serialization time via a Pydantic ``model_validator`` so
  the service layer never has to materialize it.
* ``events`` is sorted oldest-first so the UI can render a stepper.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator

from zerozero_api.domain.enums import OrderStatus, PaymentMethod, PaymentStatus
from zerozero_api.schemas.address import AddressOut

__all__ = [
    "CheckoutIn",
    "OrderItemOut",
    "OrderListItem",
    "OrderDetailOut",
    "OrderStatusEventOut",
    "OrderTrackOut",
]


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------


class CheckoutIn(BaseModel):
    """Payload for ``POST /orders`` — the checkout submit.

    ``address_id`` must belong to the caller; the service layer 404s
    otherwise. ``promo_code`` is optional and gets re-validated (not
    trusted from the client); ``notes`` is free-form and capped at 512
    chars to match the DB column.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    address_id: UUID = Field(..., description="Caller's delivery address UUID.")
    payment_method: PaymentMethod = Field(
        ..., description="Selected payment method (card|upi|wallet|cod)."
    )
    promo_code: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        description="Optional promo code — re-validated server-side.",
    )
    notes: str | None = Field(
        default=None,
        max_length=512,
        description="Free-form delivery / kitchen notes.",
    )


# ---------------------------------------------------------------------------
# Order items
# ---------------------------------------------------------------------------


class OrderItemOut(BaseModel):
    """One line on a historical order.

    Snapshots of ``name`` / ``price`` are copied at checkout so later
    menu edits don't retroactively rewrite old orders.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Order-item UUID.")
    menu_item_id: UUID | None = Field(
        default=None,
        description="FK to menu_items.id; nullable if the menu item was deleted.",
    )
    name_snapshot: str = Field(..., description="Item name at time of checkout.")
    price_snapshot: Decimal = Field(
        ..., description="Unit price at time of checkout. Decimal string on wire."
    )
    qty: int = Field(..., ge=1, description="Quantity ordered.")
    options: dict[str, Any] | None = Field(
        default=None,
        description="Variant / add-on selections at time of checkout. Null when empty.",
    )

    @field_serializer("price_snapshot")
    def _serialize_price(self, value: Decimal) -> str:
        return str(value)

    @field_serializer("options", when_used="always")
    def _serialize_options(self, value: Any) -> dict[str, Any] | None:
        # Storage is JSONB (dict). Normalize ``{}`` -> None so the frontend
        # can do a simple truthy check for "has customizations".
        if value is None or (isinstance(value, dict) and not value):
            return None
        if isinstance(value, dict):
            return value
        return None


# ---------------------------------------------------------------------------
# Status events
# ---------------------------------------------------------------------------


class OrderStatusEventOut(BaseModel):
    """One transition in the order's lifecycle."""

    model_config = ConfigDict(from_attributes=True)

    status: OrderStatus = Field(
        ..., description="Status the order transitioned to at this point."
    )
    note: str | None = Field(
        default=None, description="Optional free-form note (e.g. cancel reason)."
    )
    created_at: datetime = Field(
        ..., description="Server-side timestamp of the transition (UTC)."
    )


# ---------------------------------------------------------------------------
# List + detail
# ---------------------------------------------------------------------------


class OrderListItem(BaseModel):
    """Compact card for ``GET /orders`` listings.

    ``short_id`` is the last 8 hex chars of the UUID uppercased — the
    user-facing reference shown in the UI and support channels.
    ``item_count`` is the sum of ``qty`` across lines.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Order UUID (internal identifier).")
    short_id: str = Field(
        default="",
        description="User-facing short ref = last 8 hex of UUID, uppercased.",
    )
    restaurant_name: str = Field(..., description="Owning restaurant name.")
    restaurant_image: str | None = Field(
        default=None, description="Restaurant thumbnail/cover for the tile."
    )
    total: Decimal = Field(
        ..., description="Grand total charged. Decimal string on the wire."
    )
    item_count: int = Field(
        ..., ge=0, description="Sum of ``qty`` across all order items."
    )
    status: OrderStatus = Field(..., description="Current order status.")
    placed_at: datetime = Field(..., description="When the order was placed (UTC).")
    delivered_at: datetime | None = Field(
        default=None, description="When the order was delivered (UTC). Null if not yet."
    )

    @field_serializer("total")
    def _serialize_total(self, value: Decimal) -> str:
        return str(value)

    @model_validator(mode="after")
    def _derive_short_id(self) -> OrderListItem:
        # Compute ``short_id`` from the UUID on every materialization so
        # the service layer never has to carry it alongside the row.
        if not self.short_id:
            self.short_id = str(self.id).replace("-", "")[-8:].upper()
        return self


class OrderDetailOut(OrderListItem):
    """Full detail payload for ``GET /orders/{id}`` + ``POST /orders``.

    Carries everything the order-detail page renders: the line items,
    the snapshotted address, the price breakdown, the payment status,
    and the full status-event timeline for the stepper.
    """

    items: list[OrderItemOut] = Field(
        default_factory=list,
        description="All order lines with name+price snapshots.",
    )
    address: AddressOut = Field(..., description="Delivery address snapshot.")
    subtotal: Decimal = Field(..., description="Sum of line totals before adjustments.")
    discount: Decimal = Field(
        ..., description="Promo discount applied. Decimal string on wire."
    )
    delivery_fee: Decimal = Field(
        ..., description="Computed delivery fee (0 when free_delivery promo)."
    )
    tax: Decimal = Field(..., description="5% GST approximation on subtotal.")
    payment_method: PaymentMethod = Field(..., description="Selected payment method.")
    payment_status: PaymentStatus = Field(..., description="Current payment status.")
    promo_code: str | None = Field(
        default=None, description="Applied promo code (echoes input when accepted)."
    )
    notes: str | None = Field(
        default=None, description="Free-form notes supplied at checkout."
    )
    share_token: str = Field(
        ...,
        description=(
            "Opaque token usable for anonymous tracking at "
            "``/orders/{id}/track?share_token=...``."
        ),
    )
    events: list[OrderStatusEventOut] = Field(
        default_factory=list,
        description="Full status-event log ordered oldest-first.",
    )

    @field_serializer("subtotal", "discount", "delivery_fee", "tax")
    def _serialize_money(self, value: Decimal) -> str:
        return str(value)


# ---------------------------------------------------------------------------
# Track
# ---------------------------------------------------------------------------


class OrderTrackOut(BaseModel):
    """Lightweight payload for ``GET /orders/{id}/track``.

    Used by the public tracking page and as a WebSocket fallback in
    Phase 4. ``partner_location`` is ``{"lat": float, "lng": float}`` when
    a delivery partner is assigned and has pinged, else ``None``.
    """

    model_config = ConfigDict(from_attributes=True)

    status: OrderStatus = Field(..., description="Current order status.")
    events: list[OrderStatusEventOut] = Field(
        default_factory=list,
        description="Oldest-first transition log.",
    )
    partner_location: dict[str, float] | None = Field(
        default=None,
        description=(
            "Latest delivery-partner ping as ``{lat, lng}``. Null when no "
            "partner is assigned or no ping has been received yet."
        ),
    )
    eta_minutes: int | None = Field(
        default=None,
        description="Best-effort remaining ETA in minutes. Null when unknown.",
    )

"""Payment request / response schemas.

Implements the Phase 3 Payments contract:

    MockChargeIn   — body for ``POST /payments/mock/charge``
    MockChargeOut  — response for the same
    WebhookIn      — raw-dict body for ``POST /payments/webhook``

Money is always ``Decimal`` on the wire — see the cross-cutting rule in
``CLAUDE.md`` (never float for prices).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from zerozero_api.domain.enums import PaymentStatus

__all__ = [
    "MockChargeIn",
    "MockChargeOut",
    "WebhookIn",
]


class MockChargeIn(BaseModel):
    """Payload for ``POST /payments/mock/charge``."""

    model_config = ConfigDict(str_strip_whitespace=True)

    order_id: UUID
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)


class MockChargeOut(BaseModel):
    """Response from the mock charge endpoint.

    ``provider_ref`` is a ``mock_<12-hex>`` synthetic reference that
    mimics what a real PSP would return. ``redirect_url`` is reserved
    for a simulated 3-D-Secure flow; the mock always sets it to None.
    """

    model_config = ConfigDict(from_attributes=True)

    order_id: UUID
    payment_status: PaymentStatus
    provider_ref: str
    redirect_url: str | None = None


class WebhookIn(BaseModel):
    """Raw-dict payload for ``POST /payments/webhook``.

    The webhook body is treated as an opaque dict so the handler can
    evolve without breaking the schema. We validate structure inside
    the service based on ``event``.
    """

    event: str
    order_id: UUID
    payload: dict[str, Any] | None = None

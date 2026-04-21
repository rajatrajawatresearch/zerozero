"""Promo validation schemas.

Wire DTOs for ``POST /promos/validate``. The endpoint is a *preview* — it
never mutates ``promo_codes`` state. The authoritative apply happens
inside ``order_service.checkout`` via
``promo_service.validate_and_apply``.

Money values cross the wire as strings (``Decimal``) per repo-wide rule:
backend computes with ``Decimal``, JS formats via ``Intl.NumberFormat``.
"""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

__all__ = ["PromoValidateIn", "PromoValidateOut"]


class PromoValidateIn(BaseModel):
    """Payload for ``POST /promos/validate``.

    ``subtotal`` is the cart subtotal *before* delivery/tax so the service
    can apply the ``min_order`` gate and cap percent discounts against it.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    code: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="Case-sensitive promo code the user typed.",
    )
    subtotal: Decimal = Field(
        ...,
        ge=Decimal("0"),
        description="Cart subtotal in INR; used for min_order gate and percent cap.",
    )


class PromoValidateOut(BaseModel):
    """Result of a validation probe.

    Semantics:
      - ``valid=True``  → ``discount`` is applied, ``reason`` is ``None``.
      - ``valid=False`` → ``discount`` is ``Decimal("0")``, ``reason`` is
        one of: ``"invalid"``, ``"inactive"``, ``"expired"``,
        ``"min_order"``, ``"usage_exceeded"``.
      - ``free_delivery`` is a flag orthogonal to ``discount`` — some codes
        grant both (e.g. ``FREESHIP``).
    """

    code: str = Field(..., description="Echo of the submitted code.")
    valid: bool = Field(..., description="True iff the promo can be applied now.")
    discount: Decimal = Field(
        ...,
        ge=Decimal("0"),
        description="Computed discount in INR; 0 when not valid.",
    )
    reason: str | None = Field(
        default=None,
        description=(
            "Failure reason when valid=False. One of: "
            '"invalid" | "inactive" | "expired" | "min_order" | "usage_exceeded".'
        ),
    )
    free_delivery: bool = Field(
        default=False,
        description="True if this promo also waives the delivery fee.",
    )

"""Promo validation + apply service.

Two public entry points, different semantics by design:

1. :func:`validate` — used by ``POST /promos/validate`` (router).
   Never raises on a bad promo; returns a structured
   :class:`PromoValidateOut` with ``valid=False`` and a human-readable
   ``reason`` so the UI can render a friendly inline message next to the
   promo input. This is a *preview* — it never mutates ``promo_codes``.

2. :func:`validate_and_apply` — used by ``order_service.checkout``
   (Agent 2). Returns ``(discount, free_delivery)`` on success and
   **raises** :class:`ValidationError_` with ``code="invalid_promo"``
   and the reason surfaced in ``detail`` on any failure, so checkout
   aborts with a clear message instead of silently swallowing the code.
   (Decision documented in Phase-3 contracts — fail-loud at checkout.)

Discount math:
  - FLAT: ``min(value, subtotal)`` — never negative totals.
  - PERCENT: ``min(subtotal * value / 100, max_discount or subtotal)``
    then rounded to 2dp (ROUND_HALF_UP) to match Indian currency UX.

``FREESHIP`` is special-cased per the Phase-3 spec: any valid code whose
textual form equals ``"FREESHIP"`` (case-insensitive) also flips
``free_delivery=True``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.errors import ValidationError_
from zerozero_api.domain.enums import DiscountType
from zerozero_api.domain.promo import PromoCode
from zerozero_api.schemas.promo import PromoValidateOut

__all__ = ["validate", "validate_and_apply"]


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_FREESHIP_CODE = "FREESHIP"
_TWO_PLACES = Decimal("0.01")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _round_money(amount: Decimal) -> Decimal:
    """Round to two decimal places with banker-unfriendly HALF_UP.

    Matches the expectation of Indian e-commerce: ``0.125`` → ``0.13``.
    """
    return amount.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)


async def _load_code(db: AsyncSession, code: str) -> PromoCode | None:
    """Case-sensitive lookup by code.

    ``promo_codes.code`` is unique + indexed. We trim incoming whitespace
    at the schema layer; here we just compare verbatim.
    """
    stmt = select(PromoCode).where(PromoCode.code == code)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


def _compute_discount(promo: PromoCode, subtotal: Decimal) -> Decimal:
    """Compute the discount value for a valid promo against ``subtotal``.

    Callers must have already passed the ``min_order``, window, and usage
    gates — this function only does arithmetic.
    """
    if promo.discount_type is DiscountType.FLAT:
        return _round_money(min(promo.value, subtotal))

    # PERCENT: value is like ``10`` meaning 10%.
    percent_off = subtotal * (promo.value / Decimal("100"))
    cap = promo.max_discount if promo.max_discount is not None else subtotal
    return _round_money(min(percent_off, cap))


def _evaluate(
    promo: PromoCode | None,
    subtotal: Decimal,
    *,
    now: datetime,
) -> tuple[bool, Decimal, str | None]:
    """Gate + compute. Returns ``(valid, discount, reason)``.

    Pure function — kept separate so both public entry points share one
    source of truth and the unit tests can target it directly.
    """
    if promo is None:
        return False, Decimal("0"), "invalid"
    if not promo.is_active:
        return False, Decimal("0"), "inactive"
    if now < promo.valid_from or now > promo.valid_to:
        return False, Decimal("0"), "expired"
    if subtotal < promo.min_order:
        return False, Decimal("0"), "min_order"
    if promo.usage_limit is not None and promo.used_count >= promo.usage_limit:
        return False, Decimal("0"), "usage_exceeded"

    return True, _compute_discount(promo, subtotal), None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def validate(
    db: AsyncSession,
    code: str,
    subtotal: Decimal,
    user_id: UUID | None,
) -> PromoValidateOut:
    """Preview a promo against a cart subtotal.

    Never raises on a bad/unknown/expired code — returns
    :class:`PromoValidateOut` with ``valid=False`` and a ``reason`` the UI
    can render next to the input. This is intentionally lenient so the
    promo field feels responsive: a user typing ``FOO`` gets instant
    feedback instead of a 4xx modal.

    ``user_id`` is accepted for future per-user usage caps but not yet
    enforced (Phase-3 schema ships global ``used_count`` only).
    """
    _ = user_id  # reserved for future per-user caps
    promo = await _load_code(db, code)
    now = datetime.now(UTC)
    valid, discount, reason = _evaluate(promo, subtotal, now=now)

    free_delivery = (
        valid and promo is not None and promo.code.upper() == _FREESHIP_CODE
    )

    return PromoValidateOut(
        code=code,
        valid=valid,
        discount=discount,
        reason=reason,
        free_delivery=free_delivery,
    )


async def validate_and_apply(
    code: str,
    subtotal: Decimal,
    user_id: UUID,
    db: AsyncSession,
) -> tuple[Decimal, bool]:
    """Authoritative apply called by ``order_service.checkout``.

    **Raises** :class:`ValidationError_` with ``code="invalid_promo"`` on
    any failure so checkout aborts with a clear error message instead of
    silently applying zero discount. The failure ``reason`` (``expired``,
    ``min_order``, etc.) is attached via ``extra.reason`` so the order
    router can surface it verbatim.

    Returns ``(discount, free_delivery)`` on success.
    """
    _ = user_id  # reserved for future per-user caps
    promo = await _load_code(db, code)
    now = datetime.now(UTC)
    valid, discount, reason = _evaluate(promo, subtotal, now=now)

    if not valid:
        raise ValidationError_(
            "invalid_promo",
            code="invalid_promo",
            extra={"reason": reason or "invalid"},
        )

    assert promo is not None  # narrowed by `valid` above
    free_delivery = promo.code.upper() == _FREESHIP_CODE
    return discount, free_delivery

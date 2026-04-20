"""Promo-code seeder.

Seeds 5 working promo codes covering the discount-type matrix used by
``services/promo_service.py`` in Phase 3:

    * ``FLAT100``   — flat ₹100 off, min order ₹500.
    * ``SAVE50``    — 50% off up to ₹150, min order ₹300.
    * ``NEWUSER``   — 30% off up to ₹200, min order ₹249, usage_limit 1.
    * ``WEEKEND``   — flat ₹150 off, min order ₹699, time-boxed.
    * ``FREESHIP``  — 0% discount flag used to toggle free delivery
                     (phase-3 will interpret the row; here we just seed it).

Idempotent on ``code``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.domain.enums import DiscountType

__all__ = ["seed_promos"]


async def seed_promos(session: AsyncSession) -> int:
    """Seed promo codes. Returns count of rows present after seed."""
    from zerozero_api.domain.promo import PromoCode

    now = datetime.now(UTC)
    valid_from = now - timedelta(days=1)
    valid_to = now + timedelta(days=365)
    weekend_valid_to = now + timedelta(days=90)

    fixtures = [
        {
            "code": "FLAT100",
            "discount_type": DiscountType.FLAT,
            "value": Decimal("100"),
            "min_order": Decimal("500"),
            "max_discount": Decimal("100"),
            "valid_from": valid_from,
            "valid_to": valid_to,
            "usage_limit": None,
            "is_active": True,
        },
        {
            "code": "SAVE50",
            "discount_type": DiscountType.PERCENT,
            "value": Decimal("50"),
            "min_order": Decimal("300"),
            "max_discount": Decimal("150"),
            "valid_from": valid_from,
            "valid_to": valid_to,
            "usage_limit": None,
            "is_active": True,
        },
        {
            "code": "NEWUSER",
            "discount_type": DiscountType.PERCENT,
            "value": Decimal("30"),
            "min_order": Decimal("249"),
            "max_discount": Decimal("200"),
            "valid_from": valid_from,
            "valid_to": valid_to,
            "usage_limit": 1,
            "is_active": True,
        },
        {
            "code": "WEEKEND",
            "discount_type": DiscountType.FLAT,
            "value": Decimal("150"),
            "min_order": Decimal("699"),
            "max_discount": Decimal("150"),
            "valid_from": valid_from,
            "valid_to": weekend_valid_to,
            "usage_limit": None,
            "is_active": True,
        },
        {
            # Free-delivery marker. ``value=0`` so no cart discount applies;
            # Phase 3's promo_service recognises the code by name and waives
            # the delivery fee instead.
            "code": "FREESHIP",
            "discount_type": DiscountType.PERCENT,
            "value": Decimal("0"),
            "min_order": Decimal("199"),
            "max_discount": Decimal("0"),
            "valid_from": valid_from,
            "valid_to": valid_to,
            "usage_limit": None,
            "is_active": True,
        },
    ]

    existing = {
        p.code: p for p in (await session.scalars(select(PromoCode))).all()
    }

    inserted = 0
    for row in fixtures:
        if row["code"] in existing:
            continue
        session.add(PromoCode(**row, used_count=0))
        inserted += 1

    await session.flush()
    return inserted + len(existing)

"""Integration tests for the Phase 3 promo validation endpoint.

Contract (``docs/PHASE3_CONTRACTS.md`` → Promos):
    POST /promos/validate → PromoValidateOut

Seed codes inserted by the seeder (``seed/promos.py``):
    FLAT100  — flat ₹100 off, min_order ₹500
    SAVE50   — 50% off, min_order ₹300, max_discount ₹150
    NEWUSER  — 30% off, min_order ₹249, usage_limit=1, max_discount ₹200

Assertions:
* FLAT100 at subtotal ₹500 → ``valid=true``, ``discount=100``.
* FLAT100 at subtotal ₹300 (below ₹500 gate) → ``valid=false``,
  ``reason="min_order"``.
* An inserted-for-this-test code with ``valid_to`` in the past →
  ``valid=false``, ``reason="expired"``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.domain.enums import DiscountType
from zerozero_api.domain.promo import PromoCode


VALIDATE_URL = "/api/v1/promos/validate"


async def _ensure_flat100(db: AsyncSession) -> None:
    """Insert FLAT100 if the seeder hasn't already. Idempotent on code."""
    existing = (
        await db.execute(select(PromoCode).where(PromoCode.code == "FLAT100"))
    ).scalar_one_or_none()
    if existing is not None:
        return

    now = datetime.now(UTC)
    db.add(
        PromoCode(
            code="FLAT100",
            discount_type=DiscountType.FLAT,
            value=Decimal("100"),
            min_order=Decimal("500"),
            max_discount=Decimal("100"),
            valid_from=now - timedelta(days=1),
            valid_to=now + timedelta(days=365),
            usage_limit=None,
            used_count=0,
            is_active=True,
        )
    )
    await db.flush()
    await db.commit()


async def _ensure_save50(db: AsyncSession) -> None:
    existing = (
        await db.execute(select(PromoCode).where(PromoCode.code == "SAVE50"))
    ).scalar_one_or_none()
    if existing is not None:
        return

    now = datetime.now(UTC)
    db.add(
        PromoCode(
            code="SAVE50",
            discount_type=DiscountType.PERCENT,
            value=Decimal("50"),
            min_order=Decimal("300"),
            max_discount=Decimal("150"),
            valid_from=now - timedelta(days=1),
            valid_to=now + timedelta(days=365),
            usage_limit=None,
            used_count=0,
            is_active=True,
        )
    )
    await db.flush()
    await db.commit()


async def _ensure_newuser(db: AsyncSession) -> None:
    existing = (
        await db.execute(select(PromoCode).where(PromoCode.code == "NEWUSER"))
    ).scalar_one_or_none()
    if existing is not None:
        return

    now = datetime.now(UTC)
    db.add(
        PromoCode(
            code="NEWUSER",
            discount_type=DiscountType.PERCENT,
            value=Decimal("30"),
            min_order=Decimal("249"),
            max_discount=Decimal("200"),
            valid_from=now - timedelta(days=1),
            valid_to=now + timedelta(days=365),
            usage_limit=1,
            used_count=0,
            is_active=True,
        )
    )
    await db.flush()
    await db.commit()


@pytest.mark.asyncio
async def test_flat100_valid_at_min_order_threshold(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FLAT100 at subtotal=500 → valid, discount=100."""
    await _ensure_flat100(db_session)
    await _ensure_save50(db_session)
    await _ensure_newuser(db_session)

    resp = await client.post(
        VALIDATE_URL,
        json={"code": "FLAT100", "subtotal": "500.00"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["valid"] is True
    assert Decimal(body["discount"]) == Decimal("100")
    assert body["reason"] is None


@pytest.mark.asyncio
async def test_flat100_below_min_order_is_invalid(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FLAT100 at subtotal=300 (< min_order 500) → invalid + reason=min_order."""
    await _ensure_flat100(db_session)

    resp = await client.post(
        VALIDATE_URL,
        json={"code": "FLAT100", "subtotal": "300.00"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["valid"] is False
    assert body["reason"] == "min_order"
    assert Decimal(body["discount"]) == Decimal("0")


@pytest.mark.asyncio
async def test_expired_promo_is_invalid(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A promo whose valid_to is in the past → invalid + reason=expired."""
    # Insert a one-off expired code so we don't collide with seed data.
    now = datetime.now(UTC)
    db_session.add(
        PromoCode(
            code="EXPIRED99",
            discount_type=DiscountType.FLAT,
            value=Decimal("50"),
            min_order=Decimal("0"),
            max_discount=Decimal("50"),
            valid_from=now - timedelta(days=30),
            valid_to=now - timedelta(days=1),
            usage_limit=None,
            used_count=0,
            is_active=True,
        )
    )
    await db_session.flush()
    await db_session.commit()

    resp = await client.post(
        VALIDATE_URL,
        json={"code": "EXPIRED99", "subtotal": "500.00"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["valid"] is False
    assert body["reason"] == "expired"
    assert Decimal(body["discount"]) == Decimal("0")

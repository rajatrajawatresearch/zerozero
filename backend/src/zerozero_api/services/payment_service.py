"""Payment service — mock charge + webhook handling.

This is an intentionally small module with three public entry points:

    mock_charge           — simulate a payment attempt against an order
    verify_webhook_hmac   — constant-time HMAC-SHA256 signature check
    handle_webhook        — apply a webhook event to an order

The mock provider has a deterministic rule: any amount whose string
form ends in ``.13`` is treated as FAILED, everything else succeeds.
Useful for client-side negative-path testing without spinning up a
real PSP sandbox.

Atomicity: ``AsyncSession`` is supplied by the router's ``get_db``
dependency, which commits on successful handler return. We only
``flush`` here so unique-constraint errors still surface inside the
request lifecycle.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.errors import NotFoundError, PermissionError_
from zerozero_api.core.logging import get_logger
from zerozero_api.domain.enums import PaymentStatus
from zerozero_api.domain.order import Order
from zerozero_api.domain.user import User
from zerozero_api.schemas.payment import MockChargeIn, MockChargeOut

__all__ = [
    "handle_webhook",
    "mock_charge",
    "verify_webhook_hmac",
]


_logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Mock charge
# ---------------------------------------------------------------------------


_WEBHOOK_EVENT_TO_STATUS: dict[str, PaymentStatus] = {
    "payment.paid": PaymentStatus.PAID,
    "payment.failed": PaymentStatus.FAILED,
    "payment.refunded": PaymentStatus.REFUNDED,
}


async def _load_owned_order(
    db: AsyncSession, *, order_id: UUID, user_id: UUID
) -> Order:
    """Load an order and verify it belongs to ``user_id``.

    Raises ``NotFoundError`` when the row is missing and
    ``PermissionError_`` when the caller is not the order owner — we
    deliberately separate the two so future audit logging can
    distinguish "probe" from "missing".
    """
    stmt = select(Order).where(Order.id == order_id)
    result = await db.execute(stmt)
    order = result.scalar_one_or_none()
    if order is None:
        raise NotFoundError("order not found", code="order_not_found")
    if order.user_id != user_id:
        raise PermissionError_("order does not belong to caller")
    return order


async def mock_charge(
    db: AsyncSession, user: User, data: MockChargeIn
) -> MockChargeOut:
    """Simulate a payment attempt against ``data.order_id``.

    Rules (per Phase 3 contract):
      - 300 ms artificial delay to mimic a network round-trip
      - any ``amount`` whose string form ends in ``.13`` fails
      - otherwise succeeds
      - result is written back to ``orders.payment_status`` inline
    """
    order = await _load_owned_order(db, order_id=data.order_id, user_id=user.id)

    # Simulate network latency.
    await asyncio.sleep(0.3)

    failed = str(data.amount).endswith(".13")
    new_status = PaymentStatus.FAILED if failed else PaymentStatus.PAID

    order.payment_status = new_status
    await db.flush()

    provider_ref = f"mock_{uuid4().hex[:12]}"

    _logger.info(
        "payment.charge",
        order_id=str(order.id),
        user_id=str(user.id),
        amount=str(data.amount),
        payment_status=new_status.value,
        provider_ref=provider_ref,
    )

    return MockChargeOut(
        order_id=order.id,
        payment_status=new_status,
        provider_ref=provider_ref,
        redirect_url=None,
    )


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------


def verify_webhook_hmac(
    raw_body: bytes, signature_header: str, secret: str
) -> bool:
    """Constant-time HMAC-SHA256 verification.

    The incoming header is expected to be the hex digest of
    ``HMAC-SHA256(secret, raw_body)``. Optional ``sha256=`` prefix
    (a common convention used by GitHub, Stripe-ish PSPs) is
    tolerated. Returns False on any parse/compare failure rather
    than raising — the router converts that to HTTP 401.
    """
    if not signature_header or not secret:
        return False

    provided = signature_header.strip()
    if provided.startswith("sha256="):
        provided = provided[len("sha256=") :]

    expected = hmac.new(
        key=secret.encode("utf-8"),
        msg=raw_body,
        digestmod=hashlib.sha256,
    ).hexdigest()

    try:
        return hmac.compare_digest(provided, expected)
    except TypeError:
        return False


async def handle_webhook(db: AsyncSession, payload: dict) -> None:
    """Apply a verified webhook event to the target order.

    Supported events:
      - ``payment.paid``      -> payment_status = PAID
      - ``payment.failed``    -> payment_status = FAILED
      - ``payment.refunded``  -> payment_status = REFUNDED

    Unknown events are logged and silently ignored (PSP replay safety).
    Missing orders are logged and ignored — webhooks MUST be idempotent
    and cannot assume the local DB is authoritative yet.
    """
    event = str(payload.get("event", ""))
    raw_order_id = payload.get("order_id")

    new_status = _WEBHOOK_EVENT_TO_STATUS.get(event)
    if new_status is None:
        _logger.warning("payment.webhook.unknown_event", event=event)
        return

    try:
        order_id = UUID(str(raw_order_id))
    except (ValueError, TypeError):
        _logger.warning("payment.webhook.bad_order_id", order_id=str(raw_order_id))
        return

    stmt = select(Order).where(Order.id == order_id)
    result = await db.execute(stmt)
    order = result.scalar_one_or_none()
    if order is None:
        _logger.warning(
            "payment.webhook.order_missing",
            order_id=str(order_id),
            event=event,
        )
        return

    order.payment_status = new_status
    await db.flush()

    _logger.info(
        "payment.webhook",
        event=event,
        order_id=str(order_id),
        payment_status=new_status.value,
    )


# Re-export for type checkers happy about unused imports above.
_Decimal = Decimal  # noqa: N816

"""Payments router — mock charge + HMAC-verified webhook.

Per the Phase 3 contract (``docs/PHASE3_CONTRACTS.md``):

    POST /payments/mock/charge  -> MockChargeOut (requires auth)
    POST /payments/webhook      -> {"received": true} (HMAC-only)

The webhook endpoint reads the raw body (so the HMAC matches byte-for-
byte), verifies ``X-Signature-256`` against
``settings.PAYMENT_WEBHOOK_SECRET``, then JSON-parses the payload and
dispatches to ``payment_service.handle_webhook``. A failed HMAC yields
401 — never 500 — so misconfigured PSPs get a clear signal.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.deps import get_current_user
from zerozero_api.domain.user import User
from zerozero_api.schemas.payment import MockChargeIn, MockChargeOut
from zerozero_api.services import payment_service
from zerozero_api.settings import get_settings

__all__ = ["router"]


router = APIRouter(prefix="/payments", tags=["payments"])


_WEBHOOK_SIGNATURE_HEADER = "X-Signature-256"


@router.post(
    "/mock/charge",
    response_model=MockChargeOut,
    summary="Simulate a payment charge against an order",
)
async def mock_charge(
    payload: MockChargeIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> MockChargeOut:
    """Run the mock PSP rule and persist the resulting ``payment_status``.

    Errors:
      - 404 ``order_not_found`` when the order does not exist
      - 403 ``forbidden`` when the order does not belong to the caller
    """
    return await payment_service.mock_charge(db, current, payload)


@router.post(
    "/webhook",
    status_code=status.HTTP_200_OK,
    summary="Receive a PSP webhook (HMAC-SHA256 verified)",
)
async def webhook(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Verify HMAC, parse JSON, dispatch to service.

    Reads the raw body via ``request.body()`` because the signature is
    computed over the exact bytes the PSP sent; re-serialising a
    Pydantic model would break the comparison.
    """
    settings = get_settings()
    raw_body = await request.body()

    signature = request.headers.get(_WEBHOOK_SIGNATURE_HEADER, "")
    if not payment_service.verify_webhook_hmac(
        raw_body=raw_body,
        signature_header=signature,
        secret=settings.PAYMENT_WEBHOOK_SECRET,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_signature",
        )

    try:
        payload: dict[str, Any] = json.loads(raw_body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_json",
        ) from exc

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="payload_must_be_object",
        )

    await payment_service.handle_webhook(db, payload)
    return {"received": True}

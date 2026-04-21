"""Public promos router — preview-validate a promo code.

Only one endpoint here for Phase 3: ``POST /promos/validate``. It's a
*preview* — returns structured feedback without mutating ``promo_codes``
state. The authoritative apply-at-checkout path lives in
``order_service.checkout`` via ``promo_service.validate_and_apply``.

Auth is optional on purpose: the checkout flow lets a user type a promo
before committing to login for guest-to-account conversion, and the
validation endpoint needs to mirror that. If a token IS present we just
ignore it here — user-specific caps aren't enforced yet.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.schemas.promo import PromoValidateIn, PromoValidateOut
from zerozero_api.services import promo_service

__all__ = ["router"]


router = APIRouter(prefix="/promos", tags=["promos"])


@router.post(
    "/validate",
    response_model=PromoValidateOut,
    summary="Validate a promo code against a cart subtotal",
    description=(
        "Preview how a promo code would apply to a given cart subtotal. "
        "Never mutates promo state — this is purely a preview so the UI "
        "can render live feedback next to the input. On any failure "
        "(unknown, inactive, expired, min-order, usage-exceeded) returns "
        "``valid=false`` with a ``reason`` string instead of raising."
    ),
)
async def validate_promo_endpoint(
    payload: PromoValidateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PromoValidateOut:
    """Preview-validate ``payload.code`` against ``payload.subtotal``.

    ``user_id`` is passed as ``None`` because the preview endpoint is
    intentionally anonymous — see module docstring.
    """
    return await promo_service.validate(
        db=db,
        code=payload.code,
        subtotal=payload.subtotal,
        user_id=None,
    )

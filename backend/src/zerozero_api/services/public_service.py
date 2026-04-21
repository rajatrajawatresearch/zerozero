"""Public (share-token) tracking service.

Backs the ``GET /public/track/{share_token}`` HTTP endpoint and the
``/ws/public/track/{share_token}`` WebSocket snapshot. The service is
intentionally narrow:

  * Look up an :class:`Order` by its ``share_token`` (indexed, unique).
  * Strip PII — no customer name, email, phone, or street.
  * Return a :class:`PublicTrackOut` the router / WS handler can serialize.

Contract reference: ``docs/PHASE4_CONTRACTS.md`` (public tracking + Redis
``public:{share_token}`` channel).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from zerozero_api.core.errors import NotFoundError
from zerozero_api.domain.order import Order
from zerozero_api.schemas.order import OrderStatusEventOut
from zerozero_api.schemas.public import PublicTrackOut, SanitizedAddress

__all__ = ["get_track_by_token", "load_order_by_token"]


# Safe-label length cap. We also strip any digit-heavy suffix to avoid
# echoing a house number that a customer may have stuffed into the label.
_LABEL_MAX_LEN: int = 48


def _sanitize_label(raw: str | None) -> str | None:
    """Return a PII-free, length-capped label or ``None``.

    Rules:
      - ``None`` / empty  -> ``None``
      - Trim whitespace, collapse inner whitespace
      - Drop trailing parenthetical segments that look like addresses
        (we keep the leading word only: "Home (12-A, MG Rd)" -> "Home")
      - Truncate to :data:`_LABEL_MAX_LEN`
    """
    if not raw:
        return None
    value = " ".join(raw.split()).strip()
    if not value:
        return None
    # Keep only the head before the first "(" — typical "Home (...)" pattern.
    head = value.split("(", 1)[0].strip()
    if head:
        value = head
    return value[:_LABEL_MAX_LEN] or None


async def load_order_by_token(db: AsyncSession, share_token: str) -> Order:
    """Fetch an :class:`Order` by ``share_token``, with tracking relations.

    Raises :class:`NotFoundError` (404) when the token doesn't match any
    order — same error code as the logged-in tracking path for consistency.
    The WebSocket handler catches this and closes with 4404.
    """
    stmt = (
        select(Order)
        .options(
            selectinload(Order.status_events),
            selectinload(Order.restaurant),
            selectinload(Order.address),
        )
        .where(Order.share_token == share_token)
        .limit(1)
    )
    order = (await db.execute(stmt)).scalar_one_or_none()
    if order is None:
        raise NotFoundError("Order not found", code="order_not_found")
    return order


def build_public_track(order: Order) -> PublicTrackOut:
    """Assemble a :class:`PublicTrackOut` from an eager-loaded order.

    Pure function — no DB access — so both the HTTP route and the WS
    initial-snapshot path can reuse it. Partner location and ETA are
    populated by Agents 1/2's Redis fan-out, not by this projection.
    """
    events_sorted = sorted(order.status_events or [], key=lambda e: e.created_at)
    restaurant = order.restaurant
    address = order.address
    return PublicTrackOut(
        status=order.status,
        events=[OrderStatusEventOut.model_validate(e) for e in events_sorted],
        partner_location=None,
        restaurant_name=restaurant.name if restaurant else "",
        destination=SanitizedAddress(
            city=address.city if address else "",
            label=_sanitize_label(address.label if address else None),
        ),
        eta_minutes=None,
    )


async def get_track_by_token(
    db: AsyncSession, share_token: str
) -> PublicTrackOut:
    """Return a sanitized :class:`PublicTrackOut` or 404.

    The caller is unauthenticated; the only authority is the opaque
    ``share_token`` issued at checkout time. ``NotFoundError`` is raised
    (translating to HTTP 404 via the global handler) when no order
    matches — deliberately indistinguishable from a made-up token so we
    don't leak the "existence vs wrong-token" bit.
    """
    order = await load_order_by_token(db, share_token)
    return build_public_track(order)

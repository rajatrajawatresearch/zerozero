"""Delivery-partner business logic (Phase 4).

Thin service layer behind the ``/partner/*`` router. Four public entry
points mirror the contract in ``docs/PHASE4_CONTRACTS.md``:

  * :func:`go_online` — upserts :class:`DeliveryPartner` for the caller,
    flips ``is_online=True``, stamps their current location.
  * :func:`push_locations` — appends a batch of rows into
    ``partner_locations``, fast-forwards ``DeliveryPartner.location`` to
    the newest point, and (when an active order is assigned) fans the
    latest coord out via :mod:`services.event_bus` to three channels:
    ``partners:{id}``, ``orders:{id}``, and ``public:{share_token}``.
  * :func:`accept_order` — claims an unassigned order, sets
    ``partner_id``, appends a ``confirmed`` status event, and broadcasts
    the status change on all three channels.
  * :func:`update_status` — validates a forward state transition,
    appends :class:`OrderStatusEvent`, and broadcasts.

Design notes
------------
* PostGIS geography inputs use ``ST_SetSRID(ST_MakePoint(lng, lat),
  4326)::geography`` — never raw ``POINT()`` strings.
* The state machine guard (``_NEXT_STATES``) intentionally forbids
  backward transitions; partners can't "un-deliver" an order.
* Event-bus calls are fire-and-forget but awaited so the HTTP response
  doesn't race the broadcast: front-ends relying on the WS update
  arriving *after* the REST response get deterministic ordering.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from geoalchemy2 import Geometry, WKTElement
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from zerozero_api.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionError_,
)
from zerozero_api.domain.address import Address
from zerozero_api.domain.enums import ActorType, OrderStatus
from zerozero_api.domain.order import Order, OrderStatusEvent
from zerozero_api.domain.partner import DeliveryPartner, PartnerLocation
from zerozero_api.domain.restaurant import Restaurant
from zerozero_api.domain.user import User
from zerozero_api.schemas.partner import (
    LatLng,
    PartnerAcceptOrderOut,
    PartnerLocationBatchIn,
    PartnerOnlineIn,
    PartnerStatusUpdateIn,
)

# Agent 1 contract — these modules will land in the same Phase 4 merge.
# We import them lazily inside the functions that need them to avoid a
# circular import at module load if Agent 1's files haven't been parsed
# yet by the test collector (matters only in isolated test runs).

__all__ = [
    "accept_order",
    "go_online",
    "push_locations",
    "update_status",
]


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------


# Forward transitions the partner is allowed to drive. Cancel/fail paths
# are customer/admin-owned, not partner-owned, and therefore not listed.
_NEXT_STATES: dict[OrderStatus, frozenset[OrderStatus]] = {
    OrderStatus.PLACED: frozenset({OrderStatus.CONFIRMED}),
    OrderStatus.CONFIRMED: frozenset({OrderStatus.PREPARING}),
    OrderStatus.PREPARING: frozenset({OrderStatus.READY}),
    OrderStatus.READY: frozenset({OrderStatus.OUT_FOR_DELIVERY}),
    OrderStatus.OUT_FOR_DELIVERY: frozenset({OrderStatus.DELIVERED}),
    OrderStatus.DELIVERED: frozenset(),
    OrderStatus.CANCELLED: frozenset(),
    OrderStatus.FAILED: frozenset(),
}


def _now_utc() -> datetime:
    """Return an aware UTC timestamp for WS payloads."""
    return datetime.now(tz=timezone.utc)


def _wkt_point(lat: float, lng: float) -> WKTElement:
    """Build a geography WKT point (SRID 4326). Note lng-then-lat order."""
    return WKTElement(f"POINT({lng} {lat})", srid=4326)


# ---------------------------------------------------------------------------
# Partner loader
# ---------------------------------------------------------------------------


async def _get_or_create_partner(
    db: AsyncSession, user: User
) -> DeliveryPartner:
    """Load the caller's :class:`DeliveryPartner`, inserting it if absent.

    A user with role=partner may not yet have a profile row (they could
    have just signed up via the normal auth flow). We lazily create it on
    the first ``/partner/online`` hit so admin-side onboarding isn't
    mandatory.
    """
    stmt = select(DeliveryPartner).where(DeliveryPartner.user_id == user.id)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        return existing
    partner = DeliveryPartner(user_id=user.id, is_online=False)
    db.add(partner)
    await db.flush()
    return partner


async def _require_partner(db: AsyncSession, user: User) -> DeliveryPartner:
    """Like :func:`_get_or_create_partner` but 404s instead of creating."""
    stmt = select(DeliveryPartner).where(DeliveryPartner.user_id == user.id)
    partner = (await db.execute(stmt)).scalar_one_or_none()
    if partner is None:
        raise NotFoundError(
            "Delivery partner profile not found", code="partner_not_found"
        )
    return partner


# ---------------------------------------------------------------------------
# go_online
# ---------------------------------------------------------------------------


async def go_online(
    db: AsyncSession, user: User, data: PartnerOnlineIn
) -> DeliveryPartner:
    """Flip ``is_online=True`` and stamp current coordinates.

    Upserts the profile row if the partner hasn't initialised yet (see
    :func:`_get_or_create_partner`). When ``data.vehicle`` is supplied we
    also persist it — useful for the dev simulator to switch rigs.
    """
    partner = await _get_or_create_partner(db, user)
    partner.is_online = True
    partner.location = _wkt_point(data.lat, data.lng)
    if data.vehicle is not None:
        partner.vehicle = data.vehicle
    await db.flush()
    return partner


# ---------------------------------------------------------------------------
# push_locations
# ---------------------------------------------------------------------------


async def _load_active_order_for_partner(
    db: AsyncSession, partner_id: UUID
) -> Order | None:
    """Return the single in-flight order for the partner, else None.

    "In-flight" = status is one of the post-confirm, pre-terminal states.
    Eager-loads ``restaurant`` so the broadcast can carry
    ``share_token`` without an extra round-trip.
    """
    active = (
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.READY,
        OrderStatus.OUT_FOR_DELIVERY,
    )
    stmt = (
        select(Order)
        .where(Order.partner_id == partner_id, Order.status.in_(active))
        .order_by(Order.placed_at.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def push_locations(
    db: AsyncSession, user: User, batch: PartnerLocationBatchIn
) -> int:
    """Append a batch of GPS pings and broadcast the newest.

    Steps:
      1. Load (require) the partner profile.
      2. Insert one :class:`PartnerLocation` per point.
      3. Fast-forward ``DeliveryPartner.location`` to the chronologically
         last point (max ``recorded_at``) — not just ``points[-1]``, in
         case the client uploads out-of-order.
      4. Publish a ``partner_location`` WS message to
         ``partners:{partner_id}`` (always) and, if the partner has an
         active order, additionally to ``orders:{order_id}`` and
         ``public:{share_token}``.

    Returns the count of rows inserted so the endpoint can echo it.
    """
    from zerozero_api.services.event_bus import (
        publish_order_event,
        publish_partner_event,
        publish_public_event,
    )

    partner = await _require_partner(db, user)

    # Sort so the "latest" is deterministic even on unordered input.
    points = sorted(batch.points, key=lambda p: p.recorded_at)
    for p in points:
        db.add(
            PartnerLocation(
                partner_id=partner.id,
                location=_wkt_point(p.lat, p.lng),
                speed_kmh=p.speed,
                heading=p.heading,
                recorded_at=p.recorded_at,
            )
        )
    newest = points[-1]
    partner.location = _wkt_point(newest.lat, newest.lng)
    await db.flush()

    # Broadcast only the newest point — the client tails the most recent
    # position; older points are for the historical polyline / analytics.
    payload = {
        "type": "partner_location",
        "lat": newest.lat,
        "lng": newest.lng,
        "speed": newest.speed,
        "heading": newest.heading,
        "at": newest.recorded_at.isoformat(),
    }
    await publish_partner_event(partner.id, payload)

    order = await _load_active_order_for_partner(db, partner.id)
    if order is not None:
        await publish_order_event(order.id, payload)
        if order.share_token:
            await publish_public_event(order.share_token, payload)

    return len(points)


# ---------------------------------------------------------------------------
# accept_order
# ---------------------------------------------------------------------------


async def _load_order_with_geo(
    db: AsyncSession, order_id: UUID
) -> tuple[Order, float, float, float, float]:
    """Fetch the order plus decoded pickup/drop lat-lng (4 floats).

    Returns (order, pickup_lat, pickup_lng, drop_lat, drop_lng). The two
    coord reads use PostGIS ``ST_X``/``ST_Y`` in one round-trip each —
    cheap enough that we don't bother caching on the partner record.
    """
    order_stmt = (
        select(Order)
        .options(
            selectinload(Order.restaurant),
            selectinload(Order.address),
        )
        .where(Order.id == order_id)
        .limit(1)
    )
    order = (await db.execute(order_stmt)).scalar_one_or_none()
    if order is None:
        raise NotFoundError("Order not found", code="order_not_found")

    rest_geom = cast(Restaurant.location, Geometry)
    addr_geom = cast(Address.location, Geometry)
    coord_stmt = select(
        ST_Y(rest_geom).label("p_lat"),
        ST_X(rest_geom).label("p_lng"),
        ST_Y(addr_geom).label("d_lat"),
        ST_X(addr_geom).label("d_lng"),
    ).where(
        Restaurant.id == order.restaurant_id,
        Address.id == order.address_id,
    )
    row = (await db.execute(coord_stmt)).first()
    p_lat = float(row[0] or 0.0) if row else 0.0
    p_lng = float(row[1] or 0.0) if row else 0.0
    d_lat = float(row[2] or 0.0) if row else 0.0
    d_lng = float(row[3] or 0.0) if row else 0.0
    return order, p_lat, p_lng, d_lat, d_lng


async def accept_order(
    db: AsyncSession, user: User, order_id: UUID
) -> PartnerAcceptOrderOut:
    """Claim ``order_id`` for the caller's partner profile.

    Rules:
      - Order must not already have a partner assigned (409 otherwise).
      - Order must be in a pre-delivery status (409 otherwise).
      - Transitions the order from ``placed`` → ``confirmed`` (or keeps
        it at its current state if already past ``confirmed``).

    Side effects: appends an :class:`OrderStatusEvent` and broadcasts a
    ``status`` message on ``orders:{id}``, ``partners:{partner_id}``,
    and ``public:{share_token}``.
    """
    from zerozero_api.services.event_bus import (
        publish_order_event,
        publish_partner_event,
        publish_public_event,
    )

    partner = await _require_partner(db, user)
    order, p_lat, p_lng, d_lat, d_lng = await _load_order_with_geo(db, order_id)

    if order.partner_id is not None and order.partner_id != partner.id:
        raise ConflictError(
            "Order already has a delivery partner",
            code="order_already_assigned",
        )
    if order.status in {
        OrderStatus.DELIVERED,
        OrderStatus.CANCELLED,
        OrderStatus.FAILED,
    }:
        raise ConflictError(
            f"Order cannot be accepted in status '{order.status.value}'",
            code="order_not_acceptable",
        )

    order.partner_id = partner.id
    # Only advance to CONFIRMED when the order is still in PLACED — don't
    # regress a further-along order back to CONFIRMED if an admin re-assigns.
    new_status = order.status
    if order.status == OrderStatus.PLACED:
        order.status = OrderStatus.CONFIRMED
        new_status = OrderStatus.CONFIRMED
        db.add(
            OrderStatusEvent(
                order_id=order.id,
                status=OrderStatus.CONFIRMED,
                note="Accepted by delivery partner",
                actor_type=ActorType.PARTNER,
                actor_id=user.id,
            )
        )
    partner.current_order_id = order.id
    await db.flush()

    now = _now_utc()
    payload = {
        "type": "status",
        "status": new_status.value,
        "note": "Accepted by delivery partner",
        "at": now.isoformat(),
    }
    await publish_order_event(order.id, payload)
    await publish_partner_event(partner.id, payload)
    if order.share_token:
        await publish_public_event(order.share_token, payload)

    return PartnerAcceptOrderOut(
        order_id=order.id,
        pickup=LatLng(lat=p_lat, lng=p_lng),
        drop=LatLng(lat=d_lat, lng=d_lng),
    )


# ---------------------------------------------------------------------------
# update_status
# ---------------------------------------------------------------------------


async def update_status(
    db: AsyncSession,
    user: User,
    order_id: UUID,
    data: PartnerStatusUpdateIn,
) -> Order:
    """Advance an assigned order to the requested status.

    Guards:
      - Caller's partner must own the order (403 otherwise).
      - Target must be a valid forward transition from current status
        (409 otherwise) — see :data:`_NEXT_STATES`.

    Side effects mirror :func:`accept_order`: appends event + broadcasts.
    On ``delivered`` transition we also stamp ``delivered_at`` and clear
    the partner's ``current_order_id`` so they can pick up a new gig.
    """
    from zerozero_api.services.event_bus import (
        publish_order_event,
        publish_partner_event,
        publish_public_event,
    )

    partner = await _require_partner(db, user)

    order_stmt = (
        select(Order)
        .where(Order.id == order_id)
        .limit(1)
    )
    order = (await db.execute(order_stmt)).scalar_one_or_none()
    if order is None:
        raise NotFoundError("Order not found", code="order_not_found")
    if order.partner_id != partner.id:
        raise PermissionError_(
            "Order is not assigned to this partner",
            code="order_not_owned",
        )

    allowed = _NEXT_STATES.get(order.status, frozenset())
    if data.status not in allowed:
        raise ConflictError(
            (
                f"Cannot transition from '{order.status.value}' to "
                f"'{data.status.value}'"
            ),
            code="invalid_status_transition",
        )

    order.status = data.status
    if data.status == OrderStatus.DELIVERED:
        order.delivered_at = func.now()  # type: ignore[assignment]
        partner.current_order_id = None
    db.add(
        OrderStatusEvent(
            order_id=order.id,
            status=data.status,
            note=data.note,
            actor_type=ActorType.PARTNER,
            actor_id=user.id,
        )
    )
    await db.flush()

    now = _now_utc()
    payload = {
        "type": "status",
        "status": data.status.value,
        "note": data.note,
        "at": now.isoformat(),
    }
    await publish_order_event(order.id, payload)
    await publish_partner_event(partner.id, payload)
    if order.share_token:
        await publish_public_event(order.share_token, payload)

    return order

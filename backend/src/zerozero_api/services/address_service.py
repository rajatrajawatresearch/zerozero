"""Address CRUD + default-selection service.

Wire-format uses ``lat`` / ``lng`` floats but the column is a
``geography(POINT, 4326)`` — we translate at the service boundary via
:func:`geoalchemy2.functions.ST_SetSRID` and ``ST_MakePoint`` (note:
PostGIS takes ``(lng, lat)`` order for ``ST_MakePoint``).

Reads use ``ST_X`` / ``ST_Y`` against the point (cast to geometry) so
the router returns the same floats the client supplied.
"""

from __future__ import annotations

from uuid import UUID

from geoalchemy2 import Geometry
from geoalchemy2.functions import ST_MakePoint, ST_SetSRID, ST_X, ST_Y
from sqlalchemy import cast, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.errors import NotFoundError, ValidationError_
from zerozero_api.domain.address import Address
from zerozero_api.schemas.address import AddressIn, AddressOut, AddressPatchIn

__all__ = [
    "create_address",
    "delete_address",
    "list_addresses",
    "set_default",
    "update_address",
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _point_literal(lat: float, lng: float) -> object:
    """Build the SQL expression for ``geography(POINT, 4326)`` storage.

    PostGIS expects ``ST_MakePoint(x, y)`` = ``(lng, lat)``. We cast the
    resulting geometry to ``geography`` implicitly via the column type —
    SQLAlchemy handles the coercion.
    """
    return ST_SetSRID(ST_MakePoint(lng, lat), 4326)


async def _fetch_with_coords(
    db: AsyncSession,
    *,
    user_id: UUID,
    address_id: UUID | None = None,
) -> list[tuple[Address, float, float]]:
    """Load addresses with ``(lat, lng)`` broken out of the geography column.

    Using ``ST_Y`` / ``ST_X`` against the geometry cast of the geography
    point gives us the latitude / longitude as Python floats. Returning
    them alongside the ORM row lets the router hydrate :class:`AddressOut`
    without re-querying.
    """
    # Cast geography -> geometry so ST_X / ST_Y work across PostGIS
    # versions; then read Y=lat, X=lng.
    geom = cast(Address.location, Geometry)
    lat_col = ST_Y(geom).label("lat")
    lng_col = ST_X(geom).label("lng")

    stmt = select(Address, lat_col, lng_col).where(Address.user_id == user_id)
    if address_id is not None:
        stmt = stmt.where(Address.id == address_id)
    stmt = stmt.order_by(Address.is_default.desc(), Address.created_at.desc())
    result = await db.execute(stmt)
    rows: list[tuple[Address, float, float]] = []
    for addr, lat, lng in result.all():
        rows.append((addr, float(lat) if lat is not None else 0.0, float(lng) if lng is not None else 0.0))
    return rows


def _to_out(addr: Address, lat: float, lng: float) -> AddressOut:
    """Materialize :class:`AddressOut` from an ORM row + coords tuple."""
    return AddressOut(
        id=addr.id,
        user_id=addr.user_id,
        label=addr.label,
        line1=addr.line1,
        line2=addr.line2,
        city=addr.city,
        state=addr.state,
        pincode=addr.pincode,
        lat=lat,
        lng=lng,
        is_default=addr.is_default,
        created_at=addr.created_at,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def list_addresses(db: AsyncSession, user_id: UUID) -> list[AddressOut]:
    """Return all addresses owned by ``user_id``, defaults first."""
    rows = await _fetch_with_coords(db, user_id=user_id)
    return [_to_out(addr, lat, lng) for addr, lat, lng in rows]


async def create_address(
    db: AsyncSession,
    user_id: UUID,
    data: AddressIn,
) -> AddressOut:
    """Insert a new address. If ``is_default`` is true, unset the prior one."""
    # If marked default, atomically unset any existing default first.
    if data.is_default:
        await db.execute(
            update(Address)
            .where(Address.user_id == user_id, Address.is_default.is_(True))
            .values(is_default=False)
        )

    addr = Address(
        user_id=user_id,
        label=data.label,
        line1=data.line1,
        line2=data.line2,
        city=data.city,
        state=data.state,
        pincode=data.pincode,
        location=_point_literal(data.lat, data.lng),
        is_default=data.is_default,
    )
    db.add(addr)
    await db.flush()
    # Re-read so ``created_at`` (server default) and coord floats are populated.
    rows = await _fetch_with_coords(db, user_id=user_id, address_id=addr.id)
    if not rows:  # pragma: no cover — just inserted
        raise NotFoundError("address_not_found", code="not_found")
    inserted, lat, lng = rows[0]
    return _to_out(inserted, lat, lng)


async def update_address(
    db: AsyncSession,
    *,
    user_id: UUID,
    address_id: UUID,
    patch: AddressPatchIn,
) -> AddressOut:
    """Patch a user-owned address.

    Enforces:
      - Ownership (404 if the row isn't the caller's).
      - lat/lng paired: if one is supplied the other must be too.
      - If the patch sets ``is_default=True``, unset all other defaults
        in the same transaction.
    """
    stmt = select(Address).where(
        Address.id == address_id, Address.user_id == user_id
    )
    result = await db.execute(stmt)
    addr = result.scalar_one_or_none()
    if addr is None:
        raise NotFoundError("address_not_found", code="not_found")

    data = patch.model_dump(exclude_unset=True)

    # Coordinates must be supplied together — silently updating only one
    # side would corrupt the geography point.
    has_lat = "lat" in data
    has_lng = "lng" in data
    if has_lat ^ has_lng:
        raise ValidationError_(
            "lat_lng_must_be_paired",
            code="validation_error",
        )

    new_is_default = data.pop("is_default", None)
    new_lat = data.pop("lat", None)
    new_lng = data.pop("lng", None)

    for key, value in data.items():
        setattr(addr, key, value)

    if has_lat and has_lng and new_lat is not None and new_lng is not None:
        addr.location = _point_literal(new_lat, new_lng)  # type: ignore[assignment]

    if new_is_default is True and not addr.is_default:
        await db.execute(
            update(Address)
            .where(
                Address.user_id == user_id,
                Address.is_default.is_(True),
                Address.id != addr.id,
            )
            .values(is_default=False)
        )
        addr.is_default = True
    elif new_is_default is False:
        addr.is_default = False

    db.add(addr)
    await db.flush()
    rows = await _fetch_with_coords(db, user_id=user_id, address_id=addr.id)
    updated, lat, lng = rows[0]
    return _to_out(updated, lat, lng)


async def delete_address(
    db: AsyncSession, *, user_id: UUID, address_id: UUID
) -> None:
    """Delete a user-owned address. 404 if not found."""
    stmt = select(Address).where(
        Address.id == address_id, Address.user_id == user_id
    )
    result = await db.execute(stmt)
    addr = result.scalar_one_or_none()
    if addr is None:
        raise NotFoundError("address_not_found", code="not_found")
    await db.delete(addr)
    await db.flush()


async def set_default(
    db: AsyncSession, *, user_id: UUID, address_id: UUID
) -> AddressOut:
    """Mark one address as default; unset any prior default in the same txn."""
    stmt = select(Address).where(
        Address.id == address_id, Address.user_id == user_id
    )
    result = await db.execute(stmt)
    addr = result.scalar_one_or_none()
    if addr is None:
        raise NotFoundError("address_not_found", code="not_found")

    await db.execute(
        update(Address)
        .where(
            Address.user_id == user_id,
            Address.is_default.is_(True),
            Address.id != address_id,
        )
        .values(is_default=False)
    )
    addr.is_default = True
    db.add(addr)
    await db.flush()

    rows = await _fetch_with_coords(db, user_id=user_id, address_id=addr.id)
    updated, lat, lng = rows[0]
    return _to_out(updated, lat, lng)

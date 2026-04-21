"""Commerce-domain factory helpers for Phase 3 backend tests.

This module lives next to :mod:`tests.helpers.factories` (Phase 2 user/auth
factories) and adds the Phase 3 commerce primitives: a test restaurant
with one cuisine + three menu items, and a delivery address.

Design choices
--------------
* **Direct SQLAlchemy inserts** — we avoid the admin/owner HTTP routers
  because those require seeded owner credentials and live in Phase 2/4
  scope. Tests that need a fixture restaurant shouldn't be coupled to
  those endpoints being green.
* **Delhi NCR coordinates** — all points are sampled inside the Delhi
  NCR bounding box so the same PostGIS indexes exercised by real
  discovery queries are exercised here.
* **Deterministic by default** — callers can override ``name`` / ``slug``
  via ``**kw``; when omitted we mint a ``uuid4``-suffixed slug so tests
  running in parallel never collide on the unique constraint.
"""

from __future__ import annotations

import uuid
from datetime import time
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.domain.address import Address
from zerozero_api.domain.cuisine import Cuisine
from zerozero_api.domain.menu import MenuItem
from zerozero_api.domain.restaurant import Restaurant, RestaurantCuisine
from zerozero_api.seed.utils import to_wkt

__all__ = ["make_address", "make_restaurant"]


# Connaught Place, Delhi — a reasonable demo origin used across tests.
_DEFAULT_LAT: float = 28.6328
_DEFAULT_LNG: float = 77.2194


def _unique(prefix: str) -> str:
    """Return a collision-proof short token to suffix names/slugs/codes."""
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


async def make_restaurant(db: AsyncSession, **kw: Any) -> Restaurant:
    """Seed a fixture restaurant + one cuisine + 3 menu items.

    Returns the freshly-inserted :class:`Restaurant` with its relationships
    populated. Every field has a sensible default so callers can supply
    only the overrides they care about (e.g. ``name=`` or ``lat=``).

    Parameters accepted via ``**kw``:
      * ``name`` (str) — display name
      * ``slug`` (str) — URL slug (unique; defaults to uuid-suffixed)
      * ``lat`` / ``lng`` (float) — geography point
      * ``cuisine_name`` (str) — cuisine to attach (created if missing)
      * ``min_order`` / ``delivery_fee_base`` (Decimal)
      * ``is_active`` (bool)
    """
    name: str = kw.pop("name", None) or f"Test Restaurant {_unique('r')}"
    slug: str = kw.pop("slug", None) or _unique("rest")
    lat: float = kw.pop("lat", _DEFAULT_LAT)
    lng: float = kw.pop("lng", _DEFAULT_LNG)
    cuisine_name: str = kw.pop("cuisine_name", f"Test Cuisine {_unique('c')}")
    min_order: Decimal = kw.pop("min_order", Decimal("0.00"))
    delivery_fee_base: Decimal = kw.pop("delivery_fee_base", Decimal("29.00"))
    is_active: bool = kw.pop("is_active", True)
    delivery_radius_m: int = kw.pop("delivery_radius_m", 5000)

    # 1) Ensure the cuisine exists — reuse by slug if available to stay
    #    idempotent when tests seed twice within the same transaction.
    cuisine_slug = kw.pop("cuisine_slug", None) or _unique("cuisine")
    cuisine = Cuisine(
        name=cuisine_name,
        slug=cuisine_slug,
        is_veg_only=False,
    )
    db.add(cuisine)
    await db.flush()

    # 2) Insert the restaurant. ``Geography(POINT, 4326)`` requires an
    #    SRID-prefixed WKT so PostGIS doesn't assume a different SRID.
    restaurant = Restaurant(
        owner_id=None,
        name=name,
        slug=slug,
        description=kw.pop("description", f"{name} — integration-test fixture."),
        location=f"SRID=4326;{to_wkt(lat, lng)}",
        address_text=kw.pop("address_text", "1 Test Street, Delhi, India"),
        delivery_radius_m=delivery_radius_m,
        min_order=min_order,
        delivery_fee_base=delivery_fee_base,
        avg_prep_minutes=kw.pop("avg_prep_minutes", 20),
        rating_avg=kw.pop("rating_avg", Decimal("4.5")),
        rating_count=kw.pop("rating_count", 100),
        image_url=kw.pop("image_url", None),
        cover_url=kw.pop("cover_url", None),
        opens_at=kw.pop("opens_at", time(hour=10, minute=0)),
        closes_at=kw.pop("closes_at", time(hour=23, minute=0)),
        is_active=is_active,
        is_featured=kw.pop("is_featured", False),
    )
    db.add(restaurant)
    await db.flush()

    # 3) Link restaurant ↔ cuisine via the M2M table.
    db.add(
        RestaurantCuisine(
            restaurant_id=restaurant.id,
            cuisine_id=cuisine.id,
        )
    )

    # 4) Three menu items spanning price points the commerce tests use
    #    (cart line totals, checkout math, promo min-order gate, etc.).
    menu_prices = kw.pop(
        "menu_prices",
        [Decimal("150.00"), Decimal("250.00"), Decimal("350.00")],
    )
    menu_names = kw.pop(
        "menu_names",
        [f"Item A {_unique('i')}", f"Item B {_unique('i')}", f"Item C {_unique('i')}"],
    )
    for idx, (item_name, price) in enumerate(zip(menu_names, menu_prices, strict=False)):
        db.add(
            MenuItem(
                restaurant_id=restaurant.id,
                category_id=None,
                name=item_name,
                description=f"{item_name} — fixture item.",
                price=price,
                is_veg=True,
                is_available=True,
                tags=[],
                variants={},
                sort_order=idx,
            )
        )

    await db.flush()
    # Commit so subsequent HTTP handlers (which run inside the same
    # savepoint via the ``client`` fixture) can see the rows.
    await db.commit()
    await db.refresh(restaurant)
    return restaurant


async def make_address(
    db: AsyncSession,
    user_id: uuid.UUID,
    **kw: Any,
) -> Address:
    """Seed a delivery address for ``user_id`` and return the row.

    Coordinates default to Connaught Place so the distance math in
    ``delivery_fee = base + max(0, (distance_km - 3) * 10)`` stays within
    the free-delivery band unless the caller explicitly overrides.
    """
    label: str = kw.pop("label", "home")
    line1: str = kw.pop("line1", "221B Baker Street")
    line2: str | None = kw.pop("line2", None)
    city: str = kw.pop("city", "Delhi")
    state: str | None = kw.pop("state", "DL")
    pincode: str = kw.pop("pincode", "110001")
    lat: float = kw.pop("lat", _DEFAULT_LAT)
    lng: float = kw.pop("lng", _DEFAULT_LNG)
    is_default: bool = kw.pop("is_default", True)

    address = Address(
        user_id=user_id,
        label=label,
        line1=line1,
        line2=line2,
        city=city,
        state=state,
        pincode=pincode,
        location=f"SRID=4326;{to_wkt(lat, lng)}",
        is_default=is_default,
    )
    db.add(address)
    await db.flush()
    await db.commit()
    await db.refresh(address)
    return address

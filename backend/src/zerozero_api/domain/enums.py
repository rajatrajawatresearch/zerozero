"""String enums shared across the domain layer.

All enums are ``str, Enum`` so their values serialize naturally to JSON and
render cleanly in Postgres (via ``sa.Enum(..., name=...)``). The ``name=``
argument on the SQLAlchemy side fixes the Postgres type name, letting us
reference it from raw SQL and from Alembic operations later on.
"""

from __future__ import annotations

from enum import Enum

__all__ = [
    "ActorType",
    "DiscountType",
    "NotificationType",
    "OrderStatus",
    "PaymentMethod",
    "PaymentStatus",
    "ThemeMode",
    "ThemeRadius",
    "UserRole",
    "VehicleType",
]


class UserRole(str, Enum):
    CUSTOMER = "customer"
    PARTNER = "partner"
    OWNER = "owner"
    ADMIN = "admin"


class OrderStatus(str, Enum):
    PLACED = "placed"
    CONFIRMED = "confirmed"
    PREPARING = "preparing"
    READY = "ready"
    OUT_FOR_DELIVERY = "out_for_delivery"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"
    FAILED = "failed"


class PaymentMethod(str, Enum):
    CARD = "card"
    UPI = "upi"
    WALLET = "wallet"
    COD = "cod"


class PaymentStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"


class DiscountType(str, Enum):
    FLAT = "flat"
    PERCENT = "percent"


class NotificationType(str, Enum):
    ORDER_UPDATE = "order_update"
    PROMO = "promo"
    SYSTEM = "system"
    REVIEW = "review"


class ActorType(str, Enum):
    """Who (or what) caused an order-status transition."""

    CUSTOMER = "customer"
    PARTNER = "partner"
    OWNER = "owner"
    ADMIN = "admin"
    SYSTEM = "system"


class VehicleType(str, Enum):
    BIKE = "bike"
    SCOOTER = "scooter"
    CAR = "car"
    BICYCLE = "bicycle"
    WALK = "walk"


class ThemeMode(str, Enum):
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


class ThemeRadius(str, Enum):
    SM = "sm"
    MD = "md"
    LG = "lg"

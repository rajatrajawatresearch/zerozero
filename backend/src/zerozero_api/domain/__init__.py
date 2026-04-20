"""Domain package — re-exports every ORM class so Alembic can discover them.

A single ``import zerozero_api.domain`` (performed by ``alembic/env.py``)
is enough to register every ``Base`` subclass on ``Base.metadata``, which
is a prerequisite for autogenerate to see the full schema.
"""

from __future__ import annotations

from datetime import datetime

from zerozero_api.domain.address import Address
from zerozero_api.domain.base import Base, TimestampMixin, UUIDPk
from zerozero_api.domain.cart import CartItem
from zerozero_api.domain.category import Category
from zerozero_api.domain.cuisine import Cuisine
from zerozero_api.domain.enums import (
    ActorType,
    DiscountType,
    NotificationType,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
    ThemeMode,
    ThemeRadius,
    UserRole,
    VehicleType,
)
from zerozero_api.domain.menu import MenuItem
from zerozero_api.domain.notification import Notification
from zerozero_api.domain.order import Order, OrderItem, OrderStatusEvent
from zerozero_api.domain.partner import DeliveryPartner, PartnerLocation
from zerozero_api.domain.promo import PromoCode
from zerozero_api.domain.restaurant import Restaurant, RestaurantCuisine
from zerozero_api.domain.review import Review
from zerozero_api.domain.theme import ThemePreset
from zerozero_api.domain.refresh_token import RefreshToken
from zerozero_api.domain.user import User

__all__ = [
    "ActorType",
    "Address",
    "Base",
    "CartItem",
    "Category",
    "Cuisine",
    "DeliveryPartner",
    "DiscountType",
    "MenuItem",
    "Notification",
    "NotificationType",
    "Order",
    "OrderItem",
    "OrderStatus",
    "OrderStatusEvent",
    "PartnerLocation",
    "PaymentMethod",
    "PaymentStatus",
    "PromoCode",
    "RefreshToken",
    "Restaurant",
    "RestaurantCuisine",
    "Review",
    "ThemeMode",
    "ThemePreset",
    "ThemeRadius",
    "TimestampMixin",
    "UUIDPk",
    "User",
    "UserRole",
    "VehicleType",
]

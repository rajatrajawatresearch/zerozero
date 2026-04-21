"""Cart request / response schemas.

Cart is **server-side** and single-restaurant at a time; ``CartOut``
carries the restaurant context at the top level so the frontend can
render the cart header without a second request.

Money is carried as :class:`~decimal.Decimal` internally (source of
truth = ``Numeric(12, 2)``) and serialized as a **string** on the wire
to avoid JS float loss (e.g. ``"199.00"``, not ``199.0``). The frontend
re-parses with ``Number()`` + ``Intl.NumberFormat``.

``MenuItemBrief`` is a denormalized projection of the menu item joined
onto each cart row — letting the UI render names, images, price, and
veg flags without a second ``/restaurants/{slug}/menu`` fetch.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer
from pydantic.types import conint

__all__ = [
    "CartItemIn",
    "CartItemOut",
    "CartItemPatchIn",
    "CartOut",
    "MenuItemBrief",
]


class CartItemIn(BaseModel):
    """Payload for ``POST /cart/items``.

    ``options`` is a free-form JSON object whose canonical serialization
    feeds the ``options_hash`` dedup key — two payloads that JSON-encode
    identically (keys sorted) collapse into a single row with its
    ``qty`` incremented.
    """

    model_config = ConfigDict(extra="forbid")

    menu_item_id: UUID = Field(..., description="Menu item UUID to add.")
    qty: conint(ge=1, le=50) = Field(  # type: ignore[valid-type]
        default=1,
        description="Quantity to add. Capped at 50 per line.",
    )
    options: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Optional variant / add-on selections. Canonical JSON of this "
            "object (keys sorted) feeds the dedup hash."
        ),
    )


class CartItemPatchIn(BaseModel):
    """Payload for ``PATCH /cart/items/{id}``.

    Only ``qty`` is patchable — changing ``options`` would change the
    dedup key, so callers must remove + re-add instead.
    """

    model_config = ConfigDict(extra="forbid")

    qty: conint(ge=1, le=50) = Field(  # type: ignore[valid-type]
        ..., description="New quantity. Capped at 50 per line."
    )


class MenuItemBrief(BaseModel):
    """Denormalized subset of :class:`MenuItem` for cart/order rows."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Menu item UUID.")
    name: str = Field(..., description="Item name.")
    price: Decimal = Field(
        ..., description="Unit price at request time. Decimal string on the wire."
    )
    image_url: str | None = Field(default=None, description="Optional thumbnail URL.")
    is_veg: bool = Field(..., description="Strict-veg flag.")
    is_available: bool = Field(
        ..., description="Whether the item is still orderable."
    )

    @field_serializer("price")
    def _serialize_price(self, value: Decimal) -> str:
        return str(value)


class CartItemOut(BaseModel):
    """One row in the cart, with denormalized menu-item context."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., description="Cart item UUID.")
    restaurant_id: UUID = Field(
        ..., description="Owning restaurant. Equal across all rows in the cart."
    )
    menu_item_id: UUID = Field(..., description="FK to menu_items.id.")
    qty: int = Field(..., description="Current quantity.")
    options: dict[str, Any] | None = Field(
        default=None,
        description="Variant / add-on selections as stored (JSONB). Null when empty.",
    )
    item: MenuItemBrief = Field(
        ..., description="Denormalized menu-item snapshot for UI convenience."
    )
    line_total: Decimal = Field(
        ..., description="``price * qty`` using runtime price. Decimal string on wire."
    )

    @field_serializer("line_total")
    def _serialize_line_total(self, value: Decimal) -> str:
        return str(value)


class CartOut(BaseModel):
    """Full cart payload for ``GET /cart``.

    ``restaurant_id`` / ``restaurant_name`` are ``None`` on an empty
    cart; the frontend uses that to render the empty state.
    """

    model_config = ConfigDict(from_attributes=True)

    restaurant_id: UUID | None = Field(
        default=None,
        description="Owning restaurant or None when the cart is empty.",
    )
    restaurant_name: str | None = Field(
        default=None,
        description="Owning restaurant name (denormalized for header rendering).",
    )
    items: list[CartItemOut] = Field(
        default_factory=list,
        description="Cart rows ordered by insertion time.",
    )
    subtotal: Decimal = Field(
        ...,
        description="Sum of all ``line_total`` values. Decimal string on the wire.",
    )
    item_count: int = Field(
        ..., description="Total quantity across all rows (sum of ``qty``)."
    )

    @field_serializer("subtotal")
    def _serialize_subtotal(self, value: Decimal) -> str:
        return str(value)

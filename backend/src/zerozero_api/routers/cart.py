"""Cart router — server-side persistent cart for the current user.

All endpoints require a valid access token (``get_current_user``).
Handlers are deliberately thin: they parse input, call
:mod:`zerozero_api.services.cart_service`, and serialize the result.

Business rules enforced in the service layer:
  - Single-restaurant cart: adding an item from a new restaurant
    replaces the cart; the router signals this via
    ``X-Cart-Replaced: true`` so the frontend can toast.
  - Options-hash dedup: duplicate ``(menu_item_id, options)`` combos
    collapse into a single row with bumped ``qty``.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.deps import get_current_user
from zerozero_api.domain.user import User
from zerozero_api.schemas.cart import (
    CartItemIn,
    CartItemOut,
    CartItemPatchIn,
    CartOut,
)
from zerozero_api.services import cart_service

__all__ = ["router"]


router = APIRouter(
    prefix="/cart",
    tags=["cart"],
    dependencies=[Depends(get_current_user)],
)


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=CartOut,
    summary="Get the current user's cart",
    description=(
        "Return the caller's cart with denormalized menu-item briefs. "
        "Returns an empty cart (``restaurant_id=null``, ``items=[]``) rather "
        "than 404 when nothing has been added yet."
    ),
)
async def get_cart_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> CartOut:
    """Return the full cart payload for the caller."""
    return await cart_service.get_cart(db, current.id)


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------


@router.post(
    "/items",
    response_model=CartItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add an item to the cart",
    description=(
        "Add a menu item (optionally with variant options) to the cart.\n\n"
        "Business rules:\n"
        "- If the caller's cart is currently from a different restaurant, "
        "the existing cart is cleared first; the response carries "
        "``X-Cart-Replaced: true`` so the UI can notify the user.\n"
        "- Adding the same menu item with identical options increments "
        "the existing row's ``qty`` instead of inserting a duplicate."
    ),
    responses={
        404: {"description": "Menu item or its restaurant not found."},
        422: {"description": "Menu item is unavailable."},
    },
)
async def add_cart_item_endpoint(
    payload: CartItemIn,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> CartItemOut:
    """Insert or increment a cart row for the caller."""
    item, was_replaced = await cart_service.add_item(db, current.id, payload)
    if was_replaced:
        response.headers["X-Cart-Replaced"] = "true"
    return item


@router.patch(
    "/items/{item_id}",
    response_model=CartItemOut,
    summary="Update a cart row's quantity",
    description=(
        "Patch the quantity of an existing cart row. Options are not "
        "mutable — to change options, remove and re-add the item."
    ),
    responses={404: {"description": "Cart row not found for this user."}},
)
async def update_cart_item_endpoint(
    item_id: UUID,
    payload: CartItemPatchIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> CartItemOut:
    """Update a single cart row's quantity."""
    return await cart_service.update_item(
        db, current.id, item_id, int(payload.qty)
    )


@router.delete(
    "/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a cart row",
    description="Delete a single cart row owned by the caller.",
    responses={404: {"description": "Cart row not found for this user."}},
)
async def remove_cart_item_endpoint(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> None:
    """Delete one cart row."""
    await cart_service.remove_item(db, current.id, item_id)


@router.delete(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Clear the cart",
    description="Remove every cart row owned by the caller. Idempotent.",
)
async def clear_cart_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> None:
    """Wipe the caller's cart entirely."""
    await cart_service.clear_cart(db, current.id)

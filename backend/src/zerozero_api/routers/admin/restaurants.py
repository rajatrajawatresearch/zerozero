"""Admin restaurant CRUD endpoints (owners + admins).

Routes
------
POST   /admin/restaurants          — create, returns 201 RestaurantDetail
PATCH  /admin/restaurants/{id}     — partial update, returns RestaurantDetail
DELETE /admin/restaurants/{id}     — soft delete (flips ``is_active=False``)

The router is gated at the router level via
``dependencies=[Depends(require_role(OWNER, ADMIN))]``. Per-row ownership
(owner can only edit their own restaurants) lives inside the service
layer — keeping it DRY across multiple routes that need the same check.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.deps import get_current_user, require_role
from zerozero_api.domain.enums import UserRole
from zerozero_api.domain.user import User
from zerozero_api.schemas.admin import RestaurantCreateIn, RestaurantUpdateIn
from zerozero_api.schemas.restaurant import RestaurantDetail
from zerozero_api.services.admin_restaurant_service import (
    create_restaurant as svc_create_restaurant,
)
from zerozero_api.services.admin_restaurant_service import (
    soft_delete_restaurant as svc_soft_delete,
)
from zerozero_api.services.admin_restaurant_service import (
    update_restaurant as svc_update_restaurant,
)


__all__ = ["router"]


router = APIRouter(
    prefix="/admin/restaurants",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.OWNER, UserRole.ADMIN))],
)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=RestaurantDetail,
    summary="Create a restaurant (owner/admin)",
)
async def create_restaurant_endpoint(
    payload: RestaurantCreateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> RestaurantDetail:
    """Create a restaurant owned by the current user (or by ``user`` if admin)."""
    restaurant = await svc_create_restaurant(db, user.id, payload)
    return RestaurantDetail.model_validate(restaurant)


@router.patch(
    "/{restaurant_id}",
    response_model=RestaurantDetail,
    summary="Update a restaurant (owner/admin)",
)
async def update_restaurant_endpoint(
    restaurant_id: UUID,
    payload: RestaurantUpdateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> RestaurantDetail:
    """Partially update a restaurant. Owner must match; admins can edit any."""
    restaurant = await svc_update_restaurant(db, user, restaurant_id, payload)
    return RestaurantDetail.model_validate(restaurant)


@router.delete(
    "/{restaurant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a restaurant (owner/admin)",
)
async def delete_restaurant_endpoint(
    restaurant_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Response:
    """Soft delete: marks ``is_active=False``. Historical orders survive."""
    await svc_soft_delete(db, user, restaurant_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

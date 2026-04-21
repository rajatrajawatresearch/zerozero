"""Admin menu-item CRUD endpoints (owners + admins).

Routes
------
POST   /admin/menu-items          — create, returns 201 MenuItemOut
PATCH  /admin/menu-items/{id}     — partial update, returns MenuItemOut
DELETE /admin/menu-items/{id}     — hard delete

Ownership (owner can only touch items on their own restaurants) is
enforced inside the service layer by resolving the parent restaurant and
reusing the shared ``_ensure_can_edit`` helper.
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
from zerozero_api.schemas.admin import MenuItemCreateIn, MenuItemUpdateIn
from zerozero_api.schemas.menu import MenuItemOut
from zerozero_api.services.admin_menu_service import (
    create_menu_item as svc_create_menu_item,
)
from zerozero_api.services.admin_menu_service import (
    delete_menu_item as svc_delete_menu_item,
)
from zerozero_api.services.admin_menu_service import (
    update_menu_item as svc_update_menu_item,
)


__all__ = ["router"]


router = APIRouter(
    prefix="/admin/menu-items",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.OWNER, UserRole.ADMIN))],
)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=MenuItemOut,
    summary="Create a menu item (owner/admin)",
)
async def create_menu_item_endpoint(
    payload: MenuItemCreateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> MenuItemOut:
    item = await svc_create_menu_item(db, user, payload)
    return MenuItemOut.model_validate(item)


@router.patch(
    "/{menu_item_id}",
    response_model=MenuItemOut,
    summary="Update a menu item (owner/admin)",
)
async def update_menu_item_endpoint(
    menu_item_id: UUID,
    payload: MenuItemUpdateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> MenuItemOut:
    item = await svc_update_menu_item(db, user, menu_item_id, payload)
    return MenuItemOut.model_validate(item)


@router.delete(
    "/{menu_item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a menu item (owner/admin)",
)
async def delete_menu_item_endpoint(
    menu_item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Response:
    await svc_delete_menu_item(db, user, menu_item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

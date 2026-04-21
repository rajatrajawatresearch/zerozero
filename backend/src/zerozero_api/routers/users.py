"""User + address router (``/users/me`` and ``/users/me/addresses``).

All routes are authenticated via ``get_current_user``. Addresses are
always scoped to the caller — the ``user_id`` filter is enforced at the
service layer so a well-formed attacker can't pass another user's
``address_id`` and edit it.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.deps import get_current_user
from zerozero_api.domain.user import User
from zerozero_api.schemas.address import AddressIn, AddressOut, AddressPatchIn
from zerozero_api.schemas.auth import UserOut
from zerozero_api.schemas.user import UserPatchIn
from zerozero_api.services import address_service, user_service

__all__ = ["router"]


router = APIRouter(prefix="/users", tags=["users"])


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------


@router.get(
    "/me",
    response_model=UserOut,
    summary="Return the current user's profile",
)
async def get_me(
    current: Annotated[User, Depends(get_current_user)],
) -> UserOut:
    return UserOut.model_validate(current)


@router.patch(
    "/me",
    response_model=UserOut,
    summary="Partial update of the current user's profile",
)
async def patch_me(
    payload: UserPatchIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> UserOut:
    updated = await user_service.update_me(db, current, payload)
    return UserOut.model_validate(updated)


# ---------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------


@router.get(
    "/me/addresses",
    response_model=list[AddressOut],
    summary="List the caller's saved addresses",
)
async def list_addresses(
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> list[AddressOut]:
    return await address_service.list_addresses(db, current.id)


@router.post(
    "/me/addresses",
    response_model=AddressOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new address",
)
async def create_address(
    payload: AddressIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> AddressOut:
    return await address_service.create_address(db, current.id, payload)


@router.patch(
    "/me/addresses/{address_id}",
    response_model=AddressOut,
    summary="Partial update of an existing address",
)
async def update_address(
    address_id: UUID,
    payload: AddressPatchIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> AddressOut:
    return await address_service.update_address(
        db, user_id=current.id, address_id=address_id, patch=payload
    )


@router.delete(
    "/me/addresses/{address_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an address",
)
async def delete_address(
    address_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> None:
    await address_service.delete_address(
        db, user_id=current.id, address_id=address_id
    )


@router.post(
    "/me/addresses/{address_id}/default",
    response_model=AddressOut,
    summary="Mark an address as default (atomically unsets prior default)",
)
async def set_default_address(
    address_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> AddressOut:
    return await address_service.set_default(
        db, user_id=current.id, address_id=address_id
    )

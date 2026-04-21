"""User-profile service (current-user edits).

Everything admin-scoped (role changes, user listing) lives elsewhere.
This module only handles the logged-in user updating their own profile.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.domain.user import User
from zerozero_api.schemas.user import UserPatchIn

__all__ = ["update_me"]


async def update_me(db: AsyncSession, user: User, patch: UserPatchIn) -> User:
    """Apply a partial update to the caller's profile.

    ``UserPatchIn`` uses Pydantic's ``exclude_unset`` semantics: only the
    fields actually supplied by the client get written. An explicit
    ``null`` IS allowed for nullable columns (phone, avatar_url) and
    clears them; omitted keys leave the column untouched.
    """
    data = patch.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(user, key, value)
    db.add(user)
    await db.flush()
    return user

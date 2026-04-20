from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.security import InvalidTokenError, decode_token
from zerozero_api.domain.user import User, UserRole

__all__ = [
    "get_current_user",
    "get_optional_user",
    "oauth2_scheme",
    "require_role",
]


# `auto_error=False` lets us return a consistent 401 shape ourselves
# (and lets `get_optional_user` treat missing creds as "no user" rather
# than an automatic 403 from HTTPBearer).
oauth2_scheme = HTTPBearer(auto_error=False)


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _resolve_user(
    credentials: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
) -> User | None:
    """Shared decode + lookup used by both required and optional deps.

    Returns None when:
      - no bearer credentials were supplied
      - the token fails to decode / isn't an access token
      - the user doesn't exist or is inactive
    """
    if credentials is None or not credentials.credentials:
        return None

    try:
        payload = decode_token(credentials.credentials)
    except InvalidTokenError:
        return None

    if payload.type != "access":
        return None

    try:
        user_id = UUID(payload.sub)
    except (ValueError, TypeError):
        return None

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Require a valid access token and return the owning `User`.

    Raises 401 for any failure (missing token, bad signature, expired,
    wrong token type, unknown user, deactivated user). We deliberately
    return the SAME 401 for every failure mode so callers can't probe
    for which users exist.
    """
    if credentials is None or not credentials.credentials:
        raise _unauthorized()

    user = await _resolve_user(credentials, db)
    if user is None:
        raise _unauthorized()
    return user


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Like `get_current_user`, but returns None instead of raising 401.

    Use on public endpoints whose response shape changes for logged-in
    users (e.g. restaurant list showing personalised picks).
    """
    return await _resolve_user(credentials, db)


def require_role(
    role: UserRole,
    /,
    *extra_roles: UserRole,
) -> Callable[[User], Coroutine[Any, Any, User]]:
    """Factory dep that ensures `current_user.role` is in `{role, *extra_roles}`.

    Supports both single-role and multi-role forms:
        Depends(require_role(UserRole.ADMIN))
        Depends(require_role(UserRole.OWNER, UserRole.ADMIN))
    """
    allowed_set: frozenset[UserRole] = frozenset((role, *extra_roles))

    async def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_set:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role",
            )
        return user

    return _dep

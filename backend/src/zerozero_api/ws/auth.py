"""WebSocket-specific authentication helpers.

HTTP auth (``zerozero_api.core.security``) raises ``HTTPException`` on bad
tokens, which doesn't translate to WebSocket lifecycle semantics. For WS we
want to: decode the ``?token=`` query-string param, resolve the user, and
return ``None`` when anything goes wrong — leaving the close-code decision
(4401 / 4403 / 4404) to the endpoint handler.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.security import InvalidTokenError, decode_token
from zerozero_api.domain.user import User

__all__ = [
    "WS_CLOSE_FORBIDDEN",
    "WS_CLOSE_NOT_FOUND",
    "WS_CLOSE_UNAUTHORIZED",
    "ws_get_user_from_token",
]


# RFC 6455 reserves 4000-4999 for application-level close codes.
WS_CLOSE_UNAUTHORIZED: int = 4401
WS_CLOSE_FORBIDDEN: int = 4403
WS_CLOSE_NOT_FOUND: int = 4404


async def ws_get_user_from_token(
    ws: WebSocket,  # noqa: ARG001 — kept for symmetry / future logging hooks
    token: str | None,
    session: AsyncSession,
) -> User | None:
    """Decode ``token`` and return the matching active ``User``.

    Returns ``None`` for any of:
      - missing / empty token
      - invalid signature, expired, or malformed payload
      - token type isn't ``access``
      - ``sub`` isn't a UUID
      - no such user / user is inactive

    The caller is responsible for closing the socket with the appropriate
    4xxx code. We deliberately do **not** call ``ws.close()`` here so that
    handlers that want to send a reason-body before closing retain control.
    """
    if not token:
        return None

    try:
        payload = decode_token(token)
    except InvalidTokenError:
        return None

    if payload.type != "access":
        return None

    try:
        user_id = UUID(payload.sub)
    except (ValueError, TypeError):
        return None

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    return user

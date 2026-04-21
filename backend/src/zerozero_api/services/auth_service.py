"""Authentication service — signup, login, refresh, logout.

All functions take an ``AsyncSession`` and operate on the raw domain
models. The caller (router) owns transaction boundaries; ``get_db``
commits on successful handler return.

Tokens:
  - access JWT (short-lived): holds ``sub`` = user UUID and ``role``.
  - refresh JWT (long-lived): holds ``sub`` + ``jti`` (unique id). Every
    refresh is persisted to ``refresh_tokens`` so logout and rotation
    can revoke it. Rotation: each ``POST /auth/refresh`` marks the old
    jti revoked and mints a new pair.

Security decisions:
  - Login failures collapse to a generic ``invalid_credentials`` 401 —
    never distinguish "no such user" from "wrong password" in the
    response.
  - Duplicate email uses CITEXT case-insensitive lookup so we don't
    accidentally allow ``Foo@bar.com`` and ``foo@bar.com`` to coexist.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.errors import ConflictError
from zerozero_api.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from zerozero_api.core.security import InvalidTokenError
from zerozero_api.domain.enums import UserRole
from zerozero_api.domain.refresh_token import RefreshToken
from zerozero_api.domain.user import User
from zerozero_api.schemas.auth import LoginIn, SignupIn, TokensOut
from zerozero_api.settings import get_settings

__all__ = [
    "InvalidCredentialsError",
    "InvalidRefreshTokenError",
    "login",
    "logout",
    "refresh",
    "signup",
]


class InvalidCredentialsError(Exception):
    """Raised when email/password don't match any active user.

    Distinct from :class:`InvalidTokenError` so the router can map each
    to the right HTTP detail string without changing status codes.
    """


class InvalidRefreshTokenError(Exception):
    """Raised when a refresh token is bad, expired, or revoked."""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _find_user_by_email(db: AsyncSession, email: str) -> User | None:
    """Case-insensitive user lookup.

    ``users.email`` is ``CITEXT`` so ``==`` already compares without
    case, but we lowercase the input defensively in case a future
    migration moves off CITEXT. Either way the result is identical.
    """
    stmt = select(User).where(func.lower(User.email) == email.lower())
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


def _make_token_pair(user: User) -> tuple[TokensOut, str]:
    """Build an access + refresh token pair for ``user``.

    Returns ``(tokens_out, refresh_jti)`` so the caller can persist the
    jti alongside the refresh token row.
    """
    settings = get_settings()
    jti = uuid.uuid4().hex
    access = create_access_token(
        subject=str(user.id),
        extra={"role": user.role.value},
    )
    refresh_jwt = create_refresh_token(subject=str(user.id), jti=jti)
    return (
        TokensOut(
            access_token=access,
            refresh_token=refresh_jwt,
            token_type="bearer",
            expires_in=settings.JWT_ACCESS_TTL_MINUTES * 60,
        ),
        jti,
    )


async def _store_refresh_token(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    jti: str,
    user_agent: str | None = None,
    ip: str | None = None,
) -> RefreshToken:
    """Insert a ``refresh_tokens`` row. Caller commits via session scope."""
    settings = get_settings()
    row = RefreshToken(
        user_id=user_id,
        jti=jti,
        expires_at=datetime.now(UTC) + timedelta(days=settings.JWT_REFRESH_TTL_DAYS),
        user_agent=user_agent,
        ip=ip,
    )
    db.add(row)
    await db.flush()
    return row


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def signup(
    db: AsyncSession,
    data: SignupIn,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[User, TokensOut]:
    """Create a new customer account and mint an initial token pair.

    Raises :class:`ConflictError` with code ``email_exists`` if the
    email is already registered. Defaults the role to ``CUSTOMER`` —
    admin/owner/partner promotion happens through other flows.
    """
    existing = await _find_user_by_email(db, data.email)
    if existing is not None:
        raise ConflictError("email_exists", code="email_exists")

    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        password_hash=hash_password(data.password),
        role=UserRole.CUSTOMER,
        email_verified=False,
        is_active=True,
    )
    db.add(user)
    # Flush so the auto-generated UUID is visible before we mint tokens.
    await db.flush()

    tokens, jti = _make_token_pair(user)
    await _store_refresh_token(
        db, user_id=user.id, jti=jti, user_agent=user_agent, ip=ip
    )
    return user, tokens


async def login(
    db: AsyncSession,
    data: LoginIn,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[User, TokensOut]:
    """Verify credentials and mint a token pair.

    Raises :class:`InvalidCredentialsError` for any failure — wrong
    email, wrong password, or deactivated account. Callers map this to
    HTTP 401 with the generic detail ``invalid_credentials``.
    """
    user = await _find_user_by_email(db, data.email)
    if user is None or not user.is_active:
        raise InvalidCredentialsError("invalid_credentials")
    if not verify_password(data.password, user.password_hash):
        raise InvalidCredentialsError("invalid_credentials")

    tokens, jti = _make_token_pair(user)
    await _store_refresh_token(
        db, user_id=user.id, jti=jti, user_agent=user_agent, ip=ip
    )
    return user, tokens


async def refresh(
    db: AsyncSession,
    token: str,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
) -> TokensOut:
    """Rotate a refresh token.

    Validates the refresh JWT, confirms the jti is recorded and not
    revoked / expired, revokes the old jti, and issues a fresh access +
    refresh pair. Raises :class:`InvalidRefreshTokenError` on any
    failure.
    """
    try:
        payload = decode_token(token)
    except InvalidTokenError as exc:
        raise InvalidRefreshTokenError("invalid_refresh_token") from exc

    if payload.type != "refresh" or not payload.jti:
        raise InvalidRefreshTokenError("invalid_refresh_token")

    try:
        user_id = uuid.UUID(payload.sub)
    except (ValueError, TypeError) as exc:
        raise InvalidRefreshTokenError("invalid_refresh_token") from exc

    # Look up the stored token. We intentionally don't distinguish
    # "unknown jti" from "revoked" vs "expired" — any one of them yields
    # the same 401 so attackers can't probe our token store.
    stmt = select(RefreshToken).where(RefreshToken.jti == payload.jti)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    now = datetime.now(UTC)
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise InvalidRefreshTokenError("invalid_refresh_token")
    if row.user_id != user_id:
        raise InvalidRefreshTokenError("invalid_refresh_token")

    user_stmt = select(User).where(User.id == user_id)
    user_result = await db.execute(user_stmt)
    user = user_result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise InvalidRefreshTokenError("invalid_refresh_token")

    # Rotate: revoke the old jti, issue a new pair, persist the new jti.
    row.revoked_at = now
    await db.flush()

    tokens, new_jti = _make_token_pair(user)
    await _store_refresh_token(
        db, user_id=user.id, jti=new_jti, user_agent=user_agent, ip=ip
    )
    return tokens


async def logout(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    jti: str | None,
) -> None:
    """Revoke the refresh token jti supplied at logout.

    No-ops silently if the jti is missing or already revoked — logout
    should be idempotent so repeat calls don't 500.
    """
    if not jti:
        return
    now = datetime.now(UTC)
    stmt = (
        update(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.jti == jti,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    await db.execute(stmt)

"""Auth router — signup, login, refresh, logout, me.

Every route uses ``response_model`` so the OpenAPI spec is precise and
response shapes never leak internal ORM attributes.

Error mapping:
  - ``ConflictError`` (email exists) → surfaces through the global
    ``core.errors`` handler as HTTP 409 with the contract envelope.
  - ``InvalidCredentialsError`` / ``InvalidRefreshTokenError`` → handled
    locally and converted to 401 with ``detail`` set to the code string
    so the spec is unambiguous.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import get_db
from zerozero_api.core.deps import get_current_user
from zerozero_api.core.ratelimit import limiter
from zerozero_api.core.security import InvalidTokenError, decode_token
from zerozero_api.domain.user import User
from zerozero_api.schemas.auth import (
    LoginIn,
    RefreshIn,
    SignupIn,
    TokensOut,
    UserOut,
)
from zerozero_api.services import auth_service

__all__ = ["router"]


router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Response envelopes
# ---------------------------------------------------------------------------


class AuthResponse(BaseModel):
    """Signup / login return shape: ``{user, tokens}``."""

    user: UserOut
    tokens: TokensOut


class RefreshResponse(BaseModel):
    """Refresh return shape: ``{tokens}``."""

    tokens: TokensOut


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _request_agent(request: Request) -> tuple[str | None, str | None]:
    """Pull ``User-Agent`` and client IP out of the request for audit rows."""
    ua = request.headers.get("user-agent")
    ip: str | None = None
    if request.client is not None:
        ip = request.client.host
    # Honor X-Forwarded-For when present (Starlette trusts nothing by default).
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        ip = forwarded.split(",")[0].strip() or ip
    return ua, ip


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post(
    "/signup",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new customer account",
)
async def signup(
    request: Request,
    payload: SignupIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthResponse:
    """Create a new user and return the initial token pair.

    Returns 409 with ``code=email_exists`` if the email is already taken.
    """
    ua, ip = _request_agent(request)
    user, tokens = await auth_service.signup(db, payload, user_agent=ua, ip=ip)
    return AuthResponse(user=UserOut.model_validate(user), tokens=tokens)


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="Exchange credentials for access + refresh tokens",
)
@limiter.limit("5/minute")
async def login(
    request: Request,
    payload: LoginIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthResponse:
    """Authenticate with email + password.

    All failure modes collapse to HTTP 401 ``invalid_credentials`` — no
    enumeration leaks. Rate-limited to 5 attempts / minute per client IP
    (slowapi requires the ``request: Request`` arg to key on).
    """
    ua, ip = _request_agent(request)
    try:
        user, tokens = await auth_service.login(db, payload, user_agent=ua, ip=ip)
    except auth_service.InvalidCredentialsError as exc:
        raise _unauthorized("invalid_credentials") from exc
    return AuthResponse(user=UserOut.model_validate(user), tokens=tokens)


@router.post(
    "/refresh",
    response_model=RefreshResponse,
    summary="Rotate a refresh token",
)
async def refresh(
    request: Request,
    payload: RefreshIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RefreshResponse:
    """Consume a refresh token, revoke it, and mint a fresh pair."""
    ua, ip = _request_agent(request)
    try:
        tokens = await auth_service.refresh(
            db, payload.refresh_token, user_agent=ua, ip=ip
        )
    except auth_service.InvalidRefreshTokenError as exc:
        raise _unauthorized("invalid_refresh_token") from exc
    return RefreshResponse(tokens=tokens)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke the supplied refresh token",
)
async def logout(
    payload: RefreshIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> None:
    """Revoke the jti carried inside ``payload.refresh_token``.

    We intentionally accept the refresh token in the body (rather than
    inferring it from the access token) so logging out one device
    doesn't invalidate the user's other sessions. Decoding failures are
    swallowed — logout stays idempotent and returns 204 even when the
    token is already gone.
    """
    try:
        claims = decode_token(payload.refresh_token)
    except InvalidTokenError:
        return
    if claims.type != "refresh":
        return
    await auth_service.logout(db, user_id=current.id, jti=claims.jti)


@router.get(
    "/me",
    response_model=UserOut,
    summary="Return the currently-authenticated user",
)
async def me(
    current: Annotated[User, Depends(get_current_user)],
) -> UserOut:
    """Expose the profile of whoever the bearer token identifies."""
    return UserOut.model_validate(current)

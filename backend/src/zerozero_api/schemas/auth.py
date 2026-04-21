"""Auth request / response schemas.

Implements the Phase 2 auth contract exactly:

    SignupIn, LoginIn, RefreshIn   — request bodies
    TokensOut                       — access + refresh pair
    UserOut                         — public user projection (also
                                      re-exported from ``schemas.user``)

Password policy lives here (min 8 chars, >=1 uppercase, >=1 digit) so
the same validator runs on signup and any future password-change flow.
"""

from __future__ import annotations

import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from zerozero_api.domain.enums import UserRole

__all__ = [
    "LoginIn",
    "RefreshIn",
    "SignupIn",
    "TokensOut",
    "UserOut",
]


# Indian phone-ish: 7-15 digits, optional leading '+'. Loose on purpose —
# strict E.164 validation is overkill for a Zomato-clone demo.
_PHONE_RE = re.compile(r"^\+?\d{7,15}$")


def _validate_password_strength(value: str) -> str:
    """Enforce: min length 8, at least one uppercase letter, one digit.

    Called from ``SignupIn`` (and reusable by a future password-reset
    schema). Returns the original string on success; raises ``ValueError``
    otherwise (Pydantic turns that into a 422).
    """
    if len(value) < 8:
        raise ValueError("password must be at least 8 characters")
    if not any(ch.isupper() for ch in value):
        raise ValueError("password must contain at least one uppercase letter")
    if not any(ch.isdigit() for ch in value):
        raise ValueError("password must contain at least one digit")
    return value


class SignupIn(BaseModel):
    """Payload for ``POST /auth/signup``."""

    model_config = ConfigDict(str_strip_whitespace=True)

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=32)

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return _validate_password_strength(value)

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if not _PHONE_RE.match(cleaned):
            raise ValueError("phone must be 7-15 digits, optional leading '+'")
        return cleaned


class LoginIn(BaseModel):
    """Payload for ``POST /auth/login``.

    Deliberately no password-strength validator here — we want to accept
    whatever the caller sends and reject via generic 401. Running the
    policy on login would let an attacker learn that a user's stored
    password doesn't meet current rules.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshIn(BaseModel):
    """Payload for ``POST /auth/refresh``."""

    refresh_token: str = Field(min_length=10)


class TokensOut(BaseModel):
    """Access + refresh pair returned by signup / login / refresh.

    ``expires_in`` is **seconds until the access token expires** —
    matches the OAuth2 RFC 6749 field so standard clients can consume it
    as-is.
    """

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    """Public projection of a ``User`` row.

    Lives here (rather than ``schemas.user``) because auth endpoints are
    the primary place this shape is built. ``schemas.user`` re-exports it
    so user-scoped code can import from the feature-local module.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    full_name: str
    phone: str | None = None
    role: UserRole
    avatar_url: str | None = None
    email_verified: bool
    created_at: datetime

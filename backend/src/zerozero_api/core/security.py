from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from jose import JWTError, jwt
from pydantic import BaseModel

from zerozero_api.settings import get_settings

__all__ = [
    "InvalidTokenError",
    "TokenPayload",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "hash_password",
    "password_hasher",
    "verify_password",
]


# Module-level argon2 hasher. argon2-cffi's PasswordHasher is thread-safe and
# holds the configured params (time cost, memory cost, parallelism). We use
# defaults which are already strong; tune via its constructor if needed.
password_hasher: PasswordHasher = PasswordHasher()


class InvalidTokenError(Exception):
    """Raised when a JWT fails validation (expired, bad signature, wrong type)."""


class TokenPayload(BaseModel):
    """Decoded JWT claims for access/refresh tokens."""

    sub: str
    exp: int
    iat: int
    type: Literal["access", "refresh"]
    role: str | None = None
    jti: str | None = None


def hash_password(plain: str) -> str:
    """Hash a plaintext password using argon2id."""
    return password_hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against an argon2 hash.

    Returns False on mismatch or any verification error instead of raising,
    so callers can branch on the boolean without a try/except.
    """
    try:
        return password_hasher.verify(hashed, plain)
    except VerifyMismatchError:
        return False
    except Exception:
        # Defensive: malformed hash strings, encoding issues, etc. Should
        # never happen for hashes we produce, but we never want an auth
        # endpoint to 500 because of a bad stored hash.
        return False


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _encode(payload: dict[str, Any]) -> str:
    settings = get_settings()
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    """Create a short-lived access JWT.

    `subject` becomes the `sub` claim (typically the user UUID as a string).
    `extra` may carry `role` (embedded as a top-level claim for fast RBAC
    checks without a DB lookup) plus any other custom claims.
    """
    settings = get_settings()
    now = _now_utc()
    exp = now + timedelta(minutes=settings.JWT_ACCESS_TTL_MINUTES)

    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "type": "access",
    }

    if extra:
        # Promote role to a first-class claim if present.
        if "role" in extra and extra["role"] is not None:
            payload["role"] = extra["role"]
        for key, value in extra.items():
            if key in {"sub", "iat", "exp", "type", "role"}:
                continue
            payload[key] = value

    return _encode(payload)


def create_refresh_token(subject: str, jti: str | None = None) -> str:
    """Create a long-lived refresh JWT with a `jti` for revocation tracking."""
    settings = get_settings()
    now = _now_utc()
    exp = now + timedelta(days=settings.JWT_REFRESH_TTL_DAYS)

    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "type": "refresh",
        "jti": jti or str(uuid.uuid4()),
    }
    return _encode(payload)


def decode_token(token: str) -> TokenPayload:
    """Decode + validate a JWT.

    Raises `InvalidTokenError` if:
      - signature is invalid
      - token is expired
      - claims don't match `TokenPayload` shape
      - `type` isn't one of {"access", "refresh"}
    """
    settings = get_settings()
    try:
        raw = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise InvalidTokenError(str(exc)) from exc

    try:
        return TokenPayload.model_validate(raw)
    except Exception as exc:
        raise InvalidTokenError(f"malformed token payload: {exc}") from exc

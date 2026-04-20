"""Unit tests for ``zerozero_api.core.security``.

Covers the password hashing helpers and the JWT encode/decode roundtrip,
including expiry enforcement and the refresh-token ``jti`` claim shape.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest


def test_hash_verify_roundtrip() -> None:
    """A password must verify against its own hash and fail against a wrong one."""
    from zerozero_api.core.security import hash_password, verify_password

    password = "correct horse battery staple"
    hashed = hash_password(password)

    # The hash must be an argon2id string (prefix varies by params but starts $).
    assert isinstance(hashed, str)
    assert hashed.startswith("$argon2"), f"expected argon2 hash, got: {hashed[:20]!r}"
    assert hashed != password, "hash() must not return plaintext"

    assert verify_password(password, hashed) is True
    assert verify_password("wrong password", hashed) is False
    assert verify_password("", hashed) is False


def test_access_token_roundtrip() -> None:
    """``create_access_token`` -> ``decode_token`` preserves sub + sets type='access'."""
    from zerozero_api.core.security import create_access_token, decode_token

    subject = str(uuid.uuid4())
    token = create_access_token(subject, extra={"role": "customer"})

    assert isinstance(token, str)
    assert token.count(".") == 2, "JWT must have three dot-separated segments"

    payload = decode_token(token)
    assert payload.sub == subject
    assert payload.type == "access"
    assert payload.role == "customer"
    assert payload.exp > payload.iat, "exp must be strictly after iat"


def test_expired_token_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Decoding a token whose ``exp`` is in the past must raise InvalidTokenError.

    We force expiry by monkey-patching the module's internal clock so the
    encoded payload lands with an ``exp`` in the past.
    """
    from zerozero_api.core import security as security_mod
    from zerozero_api.core.security import (
        InvalidTokenError,
        create_access_token,
        decode_token,
    )

    # Rewind the clock by 1 hour when the token is encoded; ttl is 15 minutes
    # by default so the resulting exp is ~45 minutes in the past.
    past = datetime.now(UTC) - timedelta(hours=1)
    monkeypatch.setattr(security_mod, "_now_utc", lambda: past)

    expired = create_access_token("user-123")

    with pytest.raises(InvalidTokenError):
        decode_token(expired)


def test_refresh_token_has_jti() -> None:
    """Refresh tokens must carry a UUID ``jti`` claim for revocation tracking."""
    from zerozero_api.core.security import create_refresh_token, decode_token

    subject = str(uuid.uuid4())
    token = create_refresh_token(subject)
    payload = decode_token(token)

    assert payload.type == "refresh"
    assert payload.sub == subject
    assert payload.jti is not None, "refresh token payload must include a jti"

    # jti must be a syntactically valid UUID string. uuid.UUID will raise
    # ValueError on a malformed input.
    parsed: Any = uuid.UUID(payload.jti)
    assert str(parsed) == payload.jti.lower(), "jti must round-trip through uuid.UUID"

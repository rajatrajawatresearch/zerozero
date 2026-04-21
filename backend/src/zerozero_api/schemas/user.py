"""User-scoped schemas (profile read/write).

``UserOut`` is re-exported from :mod:`zerozero_api.schemas.auth` because
the auth router is the primary constructor of that shape. Keeping both
import paths (``schemas.auth.UserOut`` and ``schemas.user.UserOut``)
stable avoids churn when feature code grows.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

from zerozero_api.schemas.auth import UserOut

__all__ = ["UserOut", "UserPatchIn"]


_PHONE_RE = re.compile(r"^\+?\d{7,15}$")


class UserPatchIn(BaseModel):
    """Payload for ``PATCH /users/me``.

    All fields optional; omitted keys leave the row untouched. We
    deliberately exclude email / role / password here — those have their
    own flows (future verify-email, admin endpoints, password reset).
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    avatar_url: str | None = Field(default=None, max_length=512)

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            # Explicit empty string means "clear the phone".
            return None
        if not _PHONE_RE.match(cleaned):
            raise ValueError("phone must be 7-15 digits, optional leading '+'")
        return cleaned

    @field_validator("avatar_url")
    @classmethod
    def _check_avatar(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if not (cleaned.startswith("http://") or cleaned.startswith("https://") or cleaned.startswith("/")):
            raise ValueError("avatar_url must be absolute http(s) URL or a site-relative path")
        return cleaned

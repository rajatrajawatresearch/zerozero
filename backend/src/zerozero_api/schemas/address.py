"""Address schemas: create, read, patch.

The on-disk model stores ``location`` as ``geography(POINT, 4326)`` but
the wire format splits lat/lng into plain floats — the service layer
translates between the two via ``ST_SetSRID(ST_MakePoint(lng, lat),
4326)``.
"""

from __future__ import annotations

import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

__all__ = ["AddressIn", "AddressOut", "AddressPatchIn"]


_PINCODE_RE = re.compile(r"^\d{6}$")


class AddressIn(BaseModel):
    """Payload for ``POST /users/me/addresses``."""

    model_config = ConfigDict(str_strip_whitespace=True)

    label: str = Field(min_length=1, max_length=64)
    line1: str = Field(min_length=1, max_length=255)
    line2: str | None = Field(default=None, max_length=255)
    city: str = Field(min_length=1, max_length=120)
    state: str = Field(min_length=1, max_length=120)
    pincode: str = Field(min_length=6, max_length=6)
    lat: float = Field(ge=-90.0, le=90.0)
    lng: float = Field(ge=-180.0, le=180.0)
    is_default: bool = False

    @field_validator("pincode")
    @classmethod
    def _check_pincode(cls, value: str) -> str:
        if not _PINCODE_RE.match(value):
            raise ValueError("pincode must be exactly 6 digits")
        return value


class AddressOut(BaseModel):
    """Server projection of an ``Address`` row.

    ``location`` (WKB geography) is NOT on the model and is never sent
    back to the client — we serve the lat/lng floats that were originally
    provided. The service layer populates these by decoding the WKB point
    via PostGIS ``ST_X`` / ``ST_Y`` in the SELECT.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    label: str
    line1: str
    line2: str | None = None
    city: str
    state: str | None = None
    pincode: str
    lat: float
    lng: float
    is_default: bool
    created_at: datetime


class AddressPatchIn(BaseModel):
    """Payload for ``PATCH /users/me/addresses/{id}``.

    All fields optional. If ``lat`` is provided, ``lng`` must be too (and
    vice-versa) — the service layer enforces that so we don't silently
    corrupt a geography point. ``is_default`` is editable here but the
    dedicated ``.../default`` endpoint is preferred (atomic unset-others).
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    label: str | None = Field(default=None, min_length=1, max_length=64)
    line1: str | None = Field(default=None, min_length=1, max_length=255)
    line2: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, min_length=1, max_length=120)
    state: str | None = Field(default=None, min_length=1, max_length=120)
    pincode: str | None = Field(default=None, min_length=6, max_length=6)
    lat: float | None = Field(default=None, ge=-90.0, le=90.0)
    lng: float | None = Field(default=None, ge=-180.0, le=180.0)
    is_default: bool | None = None

    @field_validator("pincode")
    @classmethod
    def _check_pincode(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not _PINCODE_RE.match(value):
            raise ValueError("pincode must be exactly 6 digits")
        return value

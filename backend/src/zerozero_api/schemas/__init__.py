"""Pydantic v2 request/response schemas.

Re-exports the most common schema symbols so callers can ``from
zerozero_api.schemas import UserOut`` without digging into submodules.
Keeps the import surface narrow; anything not re-exported is still
available via its submodule path.
"""

from __future__ import annotations

from zerozero_api.schemas.address import (
    AddressIn,
    AddressOut,
    AddressPatchIn,
)
from zerozero_api.schemas.auth import (
    LoginIn,
    RefreshIn,
    SignupIn,
    TokensOut,
    UserOut,
)
from zerozero_api.schemas.common import ErrorOut, ErrorPayload, PageOut
from zerozero_api.schemas.geo import GeoSearchIn, PlaceOut
from zerozero_api.schemas.user import UserPatchIn

__all__ = [
    "AddressIn",
    "AddressOut",
    "AddressPatchIn",
    "ErrorOut",
    "ErrorPayload",
    "GeoSearchIn",
    "LoginIn",
    "PageOut",
    "PlaceOut",
    "RefreshIn",
    "SignupIn",
    "TokensOut",
    "UserOut",
    "UserPatchIn",
]

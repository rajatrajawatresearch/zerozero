"""Geo / geocoding Pydantic schemas.

Contract lives in ``docs/PHASE2_CONTRACTS.md`` -> *Location & Geocoding*.

Two public shapes:
  - ``PlaceOut`` — the normalized place envelope returned by both
    ``GET /geo/search`` (list) and ``GET /geo/reverse`` (single).
  - ``GeoSearchIn`` — reusable input for autocomplete queries. Routers
    typically prefer ``Query(...)`` params directly, but the model keeps
    validation rules (min length, strip) in one place so tests can reuse.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

__all__ = ["GeoSearchIn", "PlaceOut"]


class PlaceOut(BaseModel):
    """Normalized place (Nominatim result projected to our wire shape)."""

    model_config = ConfigDict(from_attributes=True)

    label: str = Field(max_length=120)
    lat: float = Field(ge=-90.0, le=90.0)
    lng: float = Field(ge=-180.0, le=180.0)
    city: str | None = None
    state: str | None = None
    country: str | None = None
    pincode: str | None = None
    osm_place_id: str | None = None


class GeoSearchIn(BaseModel):
    """Input for ``GET /geo/search``.

    ``q`` is the free-text autocomplete string. Min length 2 so we don't
    spam Nominatim with single-char queries that are useless anyway.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    q: str = Field(min_length=2, max_length=120)

    @field_validator("q")
    @classmethod
    def _non_empty(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) < 2:
            raise ValueError("q must be at least 2 characters after trim")
        return stripped

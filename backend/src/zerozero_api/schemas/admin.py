"""Admin CRUD schemas — owner/admin restaurant + menu-item create/update payloads.

Wire format splits ``location`` into plain ``lat``/``lng`` floats; the
service layer translates these into a PostGIS ``geography(POINT, 4326)``
column via ``ST_SetSRID(ST_MakePoint(lng, lat), 4326)``.

Cuisines are referenced by slug (not UUID) on the wire — cheaper for the
client (it already renders slugs) and stable across seed regenerations.
The service resolves slugs to ``cuisine_id`` rows before inserting into
``restaurant_cuisines``.

Image / cover URLs are plain strings here: Agent 6's ``POST /uploads/image``
returns a URL and the client includes that URL in this payload. We do not
accept multipart uploads on these routes.
"""

from __future__ import annotations

import re
from datetime import time
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


__all__ = [
    "MenuItemCreateIn",
    "MenuItemUpdateIn",
    "RestaurantCreateIn",
    "RestaurantUpdateIn",
]


_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_TAGS_MAX = 16


def _check_slug(value: str | None) -> str | None:
    """Validate optional slug override is kebab-case lowercase."""
    if value is None:
        return None
    cleaned = value.strip().lower()
    if not cleaned:
        return None
    if not _SLUG_RE.match(cleaned):
        raise ValueError(
            "slug must be lowercase kebab-case (letters, digits, single dashes)"
        )
    if len(cleaned) > 200:
        raise ValueError("slug too long (max 200 chars)")
    return cleaned


def _check_url(value: str | None) -> str | None:
    """Accept absolute http(s) URLs or a site-relative path."""
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if not (
        cleaned.startswith("http://")
        or cleaned.startswith("https://")
        or cleaned.startswith("/")
    ):
        raise ValueError(
            "url must be absolute http(s) URL or a site-relative path"
        )
    if len(cleaned) > 512:
        raise ValueError("url too long (max 512 chars)")
    return cleaned


class RestaurantCreateIn(BaseModel):
    """Payload for ``POST /admin/restaurants``.

    All restaurants get a server-generated slug derived from ``name`` (see
    :func:`zerozero_api.seed.utils.slugify`). Pass ``slug`` explicitly to
    override; collisions retry with a short-uuid suffix regardless.
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    name: str = Field(min_length=2, max_length=160)
    slug: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=4000)

    # Location — required on create so the delivery-radius query works.
    lat: float = Field(ge=-90.0, le=90.0)
    lng: float = Field(ge=-180.0, le=180.0)
    address_text: str = Field(min_length=3, max_length=512)
    delivery_radius_m: int = Field(default=5000, ge=500, le=30_000)

    # Commerce.
    min_order: Decimal = Field(default=Decimal("0.00"), ge=Decimal("0"))
    delivery_fee_base: Decimal = Field(default=Decimal("0.00"), ge=Decimal("0"))
    avg_prep_minutes: int = Field(default=20, ge=1, le=240)

    # Media — URLs produced by a prior `POST /uploads/image` call.
    image_url: str | None = Field(default=None, max_length=512)
    cover_url: str | None = Field(default=None, max_length=512)

    # Hours.
    opens_at: time | None = None
    closes_at: time | None = None

    # Flags.
    is_active: bool = True
    is_featured: bool = False

    # Taxonomy — cuisine *slugs* (not UUIDs); service resolves them.
    cuisine_slugs: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("slug")
    @classmethod
    def _slug_ok(cls, value: str | None) -> str | None:
        return _check_slug(value)

    @field_validator("image_url", "cover_url")
    @classmethod
    def _url_ok(cls, value: str | None) -> str | None:
        return _check_url(value)

    @field_validator("cuisine_slugs")
    @classmethod
    def _cuisines_ok(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, str):
                raise ValueError("cuisine_slugs must be strings")
            s = item.strip().lower()
            if not s:
                continue
            if not _SLUG_RE.match(s):
                raise ValueError(f"invalid cuisine slug: {item!r}")
            if s in seen:
                continue
            seen.add(s)
            cleaned.append(s)
        return cleaned


class RestaurantUpdateIn(BaseModel):
    """Payload for ``PATCH /admin/restaurants/{id}`` — all fields optional.

    If ``lat`` is supplied, ``lng`` must be too (service enforces). Passing
    ``cuisine_slugs`` replaces the full set — pass ``None`` / omit to leave
    the existing mapping untouched.
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    name: str | None = Field(default=None, min_length=2, max_length=160)
    slug: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=4000)

    lat: float | None = Field(default=None, ge=-90.0, le=90.0)
    lng: float | None = Field(default=None, ge=-180.0, le=180.0)
    address_text: str | None = Field(default=None, min_length=3, max_length=512)
    delivery_radius_m: int | None = Field(default=None, ge=500, le=30_000)

    min_order: Decimal | None = Field(default=None, ge=Decimal("0"))
    delivery_fee_base: Decimal | None = Field(default=None, ge=Decimal("0"))
    avg_prep_minutes: int | None = Field(default=None, ge=1, le=240)

    image_url: str | None = Field(default=None, max_length=512)
    cover_url: str | None = Field(default=None, max_length=512)

    opens_at: time | None = None
    closes_at: time | None = None

    is_active: bool | None = None
    is_featured: bool | None = None

    cuisine_slugs: list[str] | None = Field(default=None, max_length=20)

    @field_validator("slug")
    @classmethod
    def _slug_ok(cls, value: str | None) -> str | None:
        return _check_slug(value)

    @field_validator("image_url", "cover_url")
    @classmethod
    def _url_ok(cls, value: str | None) -> str | None:
        return _check_url(value)

    @field_validator("cuisine_slugs")
    @classmethod
    def _cuisines_ok(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, str):
                raise ValueError("cuisine_slugs must be strings")
            s = item.strip().lower()
            if not s:
                continue
            if not _SLUG_RE.match(s):
                raise ValueError(f"invalid cuisine slug: {item!r}")
            if s in seen:
                continue
            seen.add(s)
            cleaned.append(s)
        return cleaned


class MenuItemCreateIn(BaseModel):
    """Payload for ``POST /admin/menu-items``.

    ``restaurant_id`` is explicit (rather than URL-scoped) so the same
    admin UI can batch-insert across restaurants; the service still checks
    ownership against the resolved restaurant.
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    restaurant_id: UUID
    category_id: UUID | None = None

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    price: Decimal = Field(ge=Decimal("0"))

    image_url: str | None = Field(default=None, max_length=512)
    is_veg: bool = True
    is_available: bool = True

    tags: list[str] = Field(default_factory=list, max_length=_TAGS_MAX)
    variants: dict | None = None
    sort_order: int = Field(default=0, ge=0, le=10_000)

    @field_validator("image_url")
    @classmethod
    def _url_ok(cls, value: str | None) -> str | None:
        return _check_url(value)

    @field_validator("tags")
    @classmethod
    def _tags_ok(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, str):
                raise ValueError("tags must be strings")
            t = item.strip()
            if not t:
                continue
            if len(t) > 64:
                raise ValueError("each tag max 64 chars")
            key = t.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(t)
        return cleaned


class MenuItemUpdateIn(BaseModel):
    """Payload for ``PATCH /admin/menu-items/{id}`` — all fields optional."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    category_id: UUID | None = None

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    price: Decimal | None = Field(default=None, ge=Decimal("0"))

    image_url: str | None = Field(default=None, max_length=512)
    is_veg: bool | None = None
    is_available: bool | None = None

    tags: list[str] | None = Field(default=None, max_length=_TAGS_MAX)
    variants: dict | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10_000)

    @field_validator("image_url")
    @classmethod
    def _url_ok(cls, value: str | None) -> str | None:
        return _check_url(value)

    @field_validator("tags")
    @classmethod
    def _tags_ok(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, str):
                raise ValueError("tags must be strings")
            t = item.strip()
            if not t:
                continue
            if len(t) > 64:
                raise ValueError("each tag max 64 chars")
            key = t.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(t)
        return cleaned

"""Shared utilities for the seed package.

Functions here are kept pure (no DB I/O) so they're trivially unit-testable.
The two geo helpers target Delhi NCR — the project's demo geography — and
emit WGS-84 (EPSG:4326) coordinates suitable for
``geoalchemy2.Geography(geometry_type='POINT', srid=4326)`` columns.
"""

from __future__ import annotations

import math
import random
import re
import unicodedata

__all__ = [
    "point_near",
    "random_delhi_point",
    "slugify",
    "to_wkt",
]


# Delhi NCR bounding box (approximate). Covers Delhi + Gurugram + Noida +
# Ghaziabad + Faridabad. Loose on purpose — individual restaurant fixtures
# carry their own precise coords when it matters.
_DELHI_LAT_MIN = 28.4
_DELHI_LAT_MAX = 28.9
_DELHI_LNG_MIN = 76.8
_DELHI_LNG_MAX = 77.5

# Approximate meters-per-degree at ~28.6° N.
# Latitude: 1° ≈ 111_132 m (roughly constant).
# Longitude: 1° ≈ 111_320 * cos(lat) m.
_METERS_PER_DEG_LAT = 111_132.0


def random_delhi_point(rng: random.Random | None = None) -> tuple[float, float]:
    """Return ``(lat, lng)`` uniformly sampled within the Delhi NCR box.

    Pass an explicit :class:`random.Random` to make the draw reproducible
    under a fixed seed (the seeder uses ``random.seed(42)`` + a dedicated
    instance so runs are deterministic).
    """
    r = rng or random
    lat = r.uniform(_DELHI_LAT_MIN, _DELHI_LAT_MAX)
    lng = r.uniform(_DELHI_LNG_MIN, _DELHI_LNG_MAX)
    return (round(lat, 6), round(lng, 6))


def point_near(
    lat: float,
    lng: float,
    radius_m: float,
    rng: random.Random | None = None,
) -> tuple[float, float]:
    """Jitter a coordinate by up to ``radius_m`` meters in a random direction.

    Uses an equirectangular approximation — perfectly accurate enough for
    demo data scattered across a single metro. The returned point is
    guaranteed to lie within the circle of radius ``radius_m`` centered on
    the input.
    """
    r = rng or random
    # Uniform sampling inside a disk: sqrt(u) for radial distance.
    u = r.random()
    theta = r.random() * 2 * math.pi
    distance = math.sqrt(u) * radius_m

    dlat = (distance * math.cos(theta)) / _METERS_PER_DEG_LAT
    cos_lat = max(math.cos(math.radians(lat)), 1e-6)
    dlng = (distance * math.sin(theta)) / (_METERS_PER_DEG_LAT * cos_lat)

    return (round(lat + dlat, 6), round(lng + dlng, 6))


def to_wkt(lat: float, lng: float) -> str:
    """Build a ``POINT(lng lat)`` WKT string for geography inserts.

    Note the argument order: WKT uses ``(x y)`` = ``(longitude latitude)``,
    the opposite of what most human-facing APIs accept. Wrap in
    ``ST_GeogFromText(...)`` when binding to a ``Geography`` column.
    """
    return f"POINT({lng} {lat})"


_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_SLUG_EDGES = re.compile(r"^-+|-+$")


def slugify(value: str) -> str:
    """Unicode-safe kebab-case slug.

    - Normalizes to ASCII (strips accents / non-Latin marks).
    - Lowercases.
    - Collapses runs of non-alphanumerics to a single ``-``.
    - Strips leading/trailing dashes.

    Returns ``"item"`` as a fallback when the input contains no slug-able
    characters (e.g. only punctuation or non-convertible unicode).
    """
    if not value:
        return "item"
    # Decompose unicode, strip combining marks, re-encode to ASCII.
    normalized = unicodedata.normalize("NFKD", value)
    ascii_bytes = normalized.encode("ascii", "ignore")
    ascii_str = ascii_bytes.decode("ascii").lower()
    # Replace runs of non-alphanumeric characters with '-'.
    slug = _SLUG_STRIP.sub("-", ascii_str)
    slug = _SLUG_EDGES.sub("", slug)
    return slug or "item"

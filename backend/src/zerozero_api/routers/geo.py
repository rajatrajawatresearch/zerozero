"""HTTP routes for geocoding and reverse geocoding.

Contract: ``docs/PHASE2_CONTRACTS.md`` -> *Location & Geocoding*.

Both endpoints go through the Redis cache (24h TTL) before ever
touching Nominatim. Cache keys:

  - search:   ``zz:geo:search:{normalized_q}``       (lowercased, stripped)
  - reverse:  ``zz:geo:reverse:{lat:.4f}:{lng:.4f}``  (~11m precision)

On upstream failure the underlying client returns empty results
(``[]`` / ``None``) — we mirror that to the client rather than 500.
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Query

from zerozero_api.geo.cache import get_or_set
from zerozero_api.geo.nominatim import NominatimClient, get_nominatim_client
from zerozero_api.schemas.geo import PlaceOut

__all__ = ["router"]


router = APIRouter(prefix="/geo", tags=["geo"])

# Cache TTL per contract.
_CACHE_TTL_SECONDS = 86_400


# ---------------------------------------------------------------- helpers


def _search_cache_key(q: str) -> str:
    return f"zz:geo:search:{q.strip().lower()}"


def _reverse_cache_key(lat: float, lng: float) -> str:
    return f"zz:geo:reverse:{lat:.4f}:{lng:.4f}"


async def _fetch_search(client: NominatimClient, q: str) -> str:
    """Call Nominatim and return the JSON string to cache."""
    results = await client.search(q)
    return json.dumps([r.model_dump(mode="json") for r in results])


async def _fetch_reverse(client: NominatimClient, lat: float, lng: float) -> str:
    """Call Nominatim and return the JSON string to cache (``null`` on miss)."""
    place = await client.reverse(lat, lng)
    return json.dumps(place.model_dump(mode="json") if place else None)


# ---------------------------------------------------------------- routes


@router.get(
    "/search",
    response_model=list[PlaceOut],
    summary="Forward geocode (autocomplete) via Nominatim",
)
async def search_places(
    q: Annotated[
        str,
        Query(
            min_length=2,
            max_length=120,
            description="Free-text place query (min 2 chars).",
        ),
    ],
) -> list[PlaceOut]:
    """Return up to 5 Nominatim matches for ``q``.

    Results are cached for 24h keyed by the lowercased/trimmed query.
    """
    normalized = q.strip().lower()
    client = get_nominatim_client()

    raw = await get_or_set(
        key=_search_cache_key(normalized),
        ttl_seconds=_CACHE_TTL_SECONDS,
        fetch=lambda: _fetch_search(client, normalized),
    )
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return []
    if not isinstance(payload, list):
        return []
    return [PlaceOut.model_validate(item) for item in payload]


@router.get(
    "/reverse",
    response_model=PlaceOut | None,
    summary="Reverse geocode a lat/lng pair via Nominatim",
)
async def reverse_place(
    lat: Annotated[float, Query(ge=-90.0, le=90.0, description="Latitude")],
    lng: Annotated[float, Query(ge=-180.0, le=180.0, description="Longitude")],
) -> PlaceOut | None:
    """Return the best Nominatim match for ``(lat, lng)`` or ``null``.

    The cache key is rounded to 4 decimal places (~11 m) so near-identical
    device pings collapse to a single cache slot.
    """
    client = get_nominatim_client()

    raw = await get_or_set(
        key=_reverse_cache_key(lat, lng),
        ttl_seconds=_CACHE_TTL_SECONDS,
        fetch=lambda: _fetch_reverse(client, lat, lng),
    )
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if payload is None:
        return None
    return PlaceOut.model_validate(payload)

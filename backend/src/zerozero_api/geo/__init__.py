"""Geocoding subsystem.

Public surface:
  - ``NominatimClient`` — thin async wrapper around the Nominatim HTTP API
    with a built-in 1 req/s rate limiter and User-Agent header per ToS.
  - ``get_or_set`` — small Redis-backed read-through cache helper.

Everything else in this package is implementation detail.
"""

from __future__ import annotations

from zerozero_api.geo.cache import get_or_set
from zerozero_api.geo.nominatim import NominatimClient, get_nominatim_client

__all__ = ["NominatimClient", "get_nominatim_client", "get_or_set"]

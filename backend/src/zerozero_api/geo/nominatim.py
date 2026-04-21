"""Nominatim HTTP client with rate limiting and structured observability.

Nominatim is OpenStreetMap's free geocoding service. Its usage policy
requires:

  1. A descriptive ``User-Agent`` identifying the app + contact info.
  2. At most 1 request per second globally.
  3. Aggressive caching of results (we handle that in ``geo.cache``).

This module owns the HTTP side of those rules. It exposes a single
``NominatimClient`` (with a process-wide singleton accessor) so all
callers share one ``httpx.AsyncClient`` and one rate-limit lock.

Error model: on 429 / 5xx / timeouts we log a warning and return an
empty result (``[]`` or ``None``) instead of raising. The caller renders
that as "no suggestions" — a flaky upstream shouldn't 500 our users.
"""

from __future__ import annotations

import asyncio
import time
from functools import lru_cache
from typing import Any

import httpx

from zerozero_api.core.logging import get_logger
from zerozero_api.schemas.geo import PlaceOut
from zerozero_api.settings import get_settings

__all__ = ["NominatimClient", "close_nominatim_client", "get_nominatim_client"]


_logger = get_logger("zerozero_api.geo.nominatim")

# Nominatim ToS: max 1 req/s globally. We pad slightly to avoid clock skew.
_MIN_INTERVAL_S = 1.05

# Truncation limit for the display label we surface on the wire.
_LABEL_MAX = 120


class NominatimClient:
    """Async client around ``/search`` and ``/reverse``.

    Instances are cheap; production wires a single one via the
    ``get_nominatim_client`` module accessor. Tests can build a fresh
    instance with an injected ``httpx.AsyncClient`` if needed.
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        user_agent: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        settings = get_settings()
        self._base_url = (base_url or settings.NOMINATIM_BASE_URL).rstrip("/")
        self._user_agent = user_agent or settings.NOMINATIM_USER_AGENT
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0),
            headers={"User-Agent": self._user_agent},
            follow_redirects=True,
        )
        # Rate limit primitives — enforce 1 req/s via a local lock + last-call
        # timestamp. For a multi-process deploy we'd promote this to Redis,
        # but Phase 2 runs as a single uvicorn worker so in-proc is fine.
        self._lock = asyncio.Lock()
        self._last_call_ts: float = 0.0

    # ------------------------------------------------------------------ public

    async def search(self, q: str) -> list[PlaceOut]:
        """Forward geocode — free-text -> list of places.

        Returns at most 5 results. Empty list on error / no matches.
        """
        params: dict[str, Any] = {
            "q": q,
            "format": "json",
            "addressdetails": 1,
            "limit": 5,
        }
        payload = await self._call("/search", params)
        if not isinstance(payload, list):
            return []
        return [p for p in (self._to_place(item) for item in payload) if p is not None]

    async def reverse(self, lat: float, lng: float) -> PlaceOut | None:
        """Reverse geocode — coordinates -> a single place (or None)."""
        params: dict[str, Any] = {
            "lat": lat,
            "lon": lng,
            "format": "json",
            "addressdetails": 1,
        }
        payload = await self._call("/reverse", params)
        if not isinstance(payload, dict) or payload.get("error"):
            return None
        return self._to_place(payload)

    async def aclose(self) -> None:
        """Dispose the underlying httpx client."""
        await self._client.aclose()

    # ---------------------------------------------------------------- internal

    async def _call(self, path: str, params: dict[str, Any]) -> Any:
        """Single gated HTTP GET. Returns parsed JSON or a safe empty value."""
        url = f"{self._base_url}{path}"
        await self._respect_rate_limit()

        start = time.perf_counter()
        try:
            resp = await self._client.get(url, params=params)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            duration_ms = (time.perf_counter() - start) * 1000
            _logger.warning(
                "nominatim.network_error",
                path=path,
                error=str(exc),
                duration_ms=round(duration_ms, 1),
            )
            return [] if path == "/search" else {}

        duration_ms = (time.perf_counter() - start) * 1000

        if resp.status_code >= 500 or resp.status_code == 429:
            _logger.warning(
                "nominatim.upstream_unavailable",
                path=path,
                status=resp.status_code,
                duration_ms=round(duration_ms, 1),
            )
            return [] if path == "/search" else {}

        if resp.status_code >= 400:
            _logger.warning(
                "nominatim.bad_request",
                path=path,
                status=resp.status_code,
                duration_ms=round(duration_ms, 1),
            )
            return [] if path == "/search" else {}

        try:
            data = resp.json()
        except ValueError:
            _logger.warning(
                "nominatim.invalid_json",
                path=path,
                duration_ms=round(duration_ms, 1),
            )
            return [] if path == "/search" else {}

        _logger.info(
            "nominatim.call",
            path=path,
            status=resp.status_code,
            duration_ms=round(duration_ms, 1),
            result_count=(len(data) if isinstance(data, list) else 1),
        )
        return data

    async def _respect_rate_limit(self) -> None:
        """Enforce the 1 req/s global cap with a simple sleep-until gate."""
        async with self._lock:
            now = time.monotonic()
            wait = self._last_call_ts + _MIN_INTERVAL_S - now
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call_ts = time.monotonic()

    @staticmethod
    def _to_place(item: dict[str, Any]) -> PlaceOut | None:
        """Project a raw Nominatim record into a ``PlaceOut``.

        Returns ``None`` when the coordinates are missing or unparseable —
        Nominatim occasionally returns sparse entries we can't use.
        """
        try:
            lat = float(item.get("lat"))  # type: ignore[arg-type]
            lng = float(item.get("lon"))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None

        addr: dict[str, Any] = item.get("address") or {}
        city = addr.get("city") or addr.get("town") or addr.get("village")
        display = str(item.get("display_name") or "")
        label = display[:_LABEL_MAX] if display else "Unknown location"

        osm_id = item.get("place_id")
        osm_place_id = str(osm_id) if osm_id is not None else None

        try:
            return PlaceOut(
                label=label,
                lat=lat,
                lng=lng,
                city=city,
                state=addr.get("state"),
                country=addr.get("country"),
                pincode=addr.get("postcode"),
                osm_place_id=osm_place_id,
            )
        except Exception:
            # PlaceOut validates lat/lng bounds; ignore malformed rows.
            return None


# ---------------------------------------------------------------- singleton


@lru_cache(maxsize=1)
def get_nominatim_client() -> NominatimClient:
    """Return the process-wide Nominatim client (lazily created)."""
    return NominatimClient()


async def close_nominatim_client() -> None:
    """Dispose the singleton, if created. Used by tests."""
    try:
        client = get_nominatim_client.cache_info().currsize and get_nominatim_client()
    except Exception:
        client = None
    if client:
        try:
            await client.aclose()
        except Exception:
            pass
    get_nominatim_client.cache_clear()

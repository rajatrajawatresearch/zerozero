"""HTTP middleware: request id propagation and structured access logging.

Implements the `zerozero_api.core.middleware` contract from
`docs/AGENT_CONTRACTS.md`.

Exposes:
  - ``REQUEST_ID_HEADER`` — the HTTP header name (canonically ``X-Request-ID``).
  - ``request_id_ctx``    — a module-level ``ContextVar[str]`` read by the
                            logging processor so every structured log line
                            carries the current request's id automatically.
  - ``RequestIdMiddleware`` — reads an incoming ``X-Request-ID`` if present
                              (trusted when non-empty and a valid UUID-ish
                              string, otherwise a fresh ``uuid4`` is minted),
                              populates the contextvar for the duration of
                              the request, and echoes the header back on the
                              response so clients can correlate logs.
  - ``AccessLogMiddleware`` — times each request and emits a single structured
                              log entry with ``{method, path, status,
                              duration_ms, client_ip}``. Levels are INFO for
                              2xx/3xx, WARNING for 4xx, ERROR for 5xx.
"""

from __future__ import annotations

import time
from contextvars import ContextVar
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from zerozero_api.core.logging import get_logger

__all__ = [
    "REQUEST_ID_HEADER",
    "request_id_ctx",
    "RequestIdMiddleware",
    "AccessLogMiddleware",
]


REQUEST_ID_HEADER = "X-Request-ID"

# Populated by ``RequestIdMiddleware`` on every request; read by the logging
# processor (``zerozero_api.core.logging._inject_request_id``) so every log
# line emitted during a request carries its id.
request_id_ctx: ContextVar[str] = ContextVar("request_id_ctx", default="")

_MAX_INCOMING_RID_LEN = 128
_logger = get_logger("zerozero_api.access")


def _sanitize_incoming_request_id(raw: str | None) -> str | None:
    """Return a trusted incoming request id or ``None`` to mint a new one.

    We accept any non-empty, short-ish, printable string. Defensive because
    the header is user-controlled and would otherwise end up in every log.
    """
    if not raw:
        return None
    stripped = raw.strip()
    if not stripped or len(stripped) > _MAX_INCOMING_RID_LEN:
        return None
    if not stripped.isprintable():
        return None
    return stripped


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assigns a stable request id for the duration of each request.

    Contract:
      - If the incoming request has a valid ``X-Request-ID`` we reuse it.
      - Otherwise a fresh ``uuid4`` hex is minted.
      - The id is stored in ``request_id_ctx`` (for logging) and on
        ``request.state.request_id`` (for handler code that wants it).
      - The same id is echoed on the response header for client correlation.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        incoming = _sanitize_incoming_request_id(request.headers.get(REQUEST_ID_HEADER))
        rid = incoming or uuid4().hex

        token = request_id_ctx.set(rid)
        request.state.request_id = rid
        try:
            response = await call_next(request)
        finally:
            request_id_ctx.reset(token)

        response.headers[REQUEST_ID_HEADER] = rid
        return response


class AccessLogMiddleware(BaseHTTPMiddleware):
    """Emits a structured log line per request with timing + outcome.

    Must be registered *inside* ``RequestIdMiddleware`` (i.e. added first so
    it runs second) so the request id is in the contextvar when we log.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            # Log the access line with a 500 status, then re-raise so the
            # exception handlers can shape the response envelope.
            duration_ms = (time.perf_counter() - start) * 1000.0
            _logger.error(
                "http.request",
                method=request.method,
                path=request.url.path,
                status=500,
                duration_ms=round(duration_ms, 2),
                client_ip=_client_ip(request),
                exc_info=True,
            )
            raise

        duration_ms = (time.perf_counter() - start) * 1000.0
        fields: dict[str, object] = {
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": round(duration_ms, 2),
            "client_ip": _client_ip(request),
        }
        if response.status_code >= 500:
            _logger.error("http.request", **fields)
        elif response.status_code >= 400:
            _logger.warning("http.request", **fields)
        else:
            _logger.info("http.request", **fields)
        return response


def _client_ip(request: Request) -> str:
    """Best-effort client IP extraction respecting a single proxy hop.

    Trusts ``X-Forwarded-For``'s first entry if present — deployments behind
    an untrusted network should strip/rewrite the header at the edge.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",", 1)[0].strip()
        if first:
            return first
    if request.client is not None:
        return request.client.host
    return "unknown"

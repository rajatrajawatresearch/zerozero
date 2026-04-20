"""Application exception hierarchy + FastAPI exception handlers.

Implements the `zerozero_api.core.errors` contract from
`docs/AGENT_CONTRACTS.md`.

The public surface:
  - ``AppError`` and domain-specific subclasses (Not Found / Conflict /
    Permission / Validation / RateLimit) — throw these from service code.
  - ``register_exception_handlers(app)`` — wires handlers so every error
    (ours, Pydantic's, SQLAlchemy's, Starlette's ``HTTPException``, and the
    generic ``Exception``) returns a JSON envelope of the shape
    ``{"error": {"code": ..., "detail": ..., "request_id": ...}}``.
  - 5xx paths also emit a structured error log and (if Sentry is wired up in
    ``main.py``) capture the exception.
"""

from __future__ import annotations

from typing import Any

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from zerozero_api.core.logging import get_logger
from zerozero_api.core.middleware import request_id_ctx

__all__ = [
    "AppError",
    "NotFoundError",
    "ConflictError",
    "PermissionError_",
    "ValidationError_",
    "RateLimitError",
    "register_exception_handlers",
]


_logger = get_logger("zerozero_api.errors")


# ---------------------------------------------------------------------------
# Exception hierarchy
# ---------------------------------------------------------------------------


class AppError(Exception):
    """Base application error.

    Subclasses override ``status_code``, ``code``, and optionally ``detail``.
    Callers may also pass a custom ``detail`` and an ``extra`` dict that will
    be merged into the JSON error envelope (useful for ``field`` errors).
    """

    status_code: int = 500
    detail: str = "Internal error"
    code: str = "internal_error"

    def __init__(
        self,
        detail: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        self.detail = detail or self.detail
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.extra: dict[str, Any] = extra or {}
        super().__init__(self.detail)


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"
    detail = "Resource not found"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"
    detail = "Conflicting state"


class PermissionError_(AppError):
    status_code = 403
    code = "forbidden"
    detail = "Forbidden"


class ValidationError_(AppError):
    status_code = 422
    code = "validation_error"
    detail = "Validation error"


class RateLimitError(AppError):
    status_code = 429
    code = "rate_limited"
    detail = "Too many requests"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _current_request_id(request: Request) -> str:
    """Return the current request id from state (set by ``RequestIdMiddleware``)
    or the contextvar fallback.
    """
    rid = getattr(request.state, "request_id", "") if hasattr(request, "state") else ""
    if rid:
        return str(rid)
    return request_id_ctx.get("")


def _envelope(
    *,
    code: str,
    detail: str,
    request_id: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "detail": detail, "request_id": request_id}
    if extra:
        error.update(extra)
    return {"error": error}


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def _app_error_handler(request: Request, exc: Exception) -> ORJSONResponse:
    assert isinstance(exc, AppError)
    rid = _current_request_id(request)
    # 5xx AppErrors also deserve a server-side log line.
    if exc.status_code >= 500:
        _logger.error(
            "app_error",
            code=exc.code,
            detail=exc.detail,
            status=exc.status_code,
            path=request.url.path,
            exc_info=True,
        )
    return ORJSONResponse(
        status_code=exc.status_code,
        content=_envelope(
            code=exc.code,
            detail=exc.detail,
            request_id=rid,
            extra=exc.extra or None,
        ),
    )


async def _validation_error_handler(
    request: Request, exc: Exception
) -> ORJSONResponse:
    assert isinstance(exc, RequestValidationError)
    rid = _current_request_id(request)
    # Normalize Pydantic errors into a compact list — drop the unserializable
    # ``ctx`` payloads that can contain non-JSON objects.
    normalized: list[dict[str, Any]] = []
    for err in exc.errors():
        normalized.append(
            {
                "loc": list(err.get("loc", [])),
                "msg": err.get("msg", ""),
                "type": err.get("type", ""),
            }
        )
    return ORJSONResponse(
        status_code=422,
        content=_envelope(
            code="validation_error",
            detail="Request validation failed",
            request_id=rid,
            extra={"errors": normalized},
        ),
    )


async def _sqlalchemy_error_handler(
    request: Request, exc: Exception
) -> ORJSONResponse:
    assert isinstance(exc, SQLAlchemyError)
    rid = _current_request_id(request)
    _logger.error(
        "db_error",
        path=request.url.path,
        error_type=type(exc).__name__,
        exc_info=True,
    )
    return ORJSONResponse(
        status_code=500,
        content=_envelope(
            code="database_error",
            detail="A database error occurred.",
            request_id=rid,
        ),
    )


async def _http_exception_handler(
    request: Request, exc: Exception
) -> ORJSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    rid = _current_request_id(request)
    # Starlette's HTTPException keeps a flexible ``detail`` (str | dict | list).
    # We preserve it verbatim and simply augment the envelope with request_id.
    detail: Any = exc.detail if exc.detail is not None else ""
    payload: dict[str, Any] = {
        "detail": detail,
        "request_id": rid,
    }
    headers = getattr(exc, "headers", None)
    return ORJSONResponse(status_code=exc.status_code, content=payload, headers=headers)


async def _unhandled_exception_handler(
    request: Request, exc: Exception
) -> ORJSONResponse:
    rid = _current_request_id(request)
    _logger.error(
        "unhandled_exception",
        path=request.url.path,
        error_type=type(exc).__name__,
        exc_info=True,
    )
    # Capture into Sentry — no-op when init() hasn't been called in Sentry SDK 2.x.
    try:
        sentry_sdk.capture_exception(exc)
    except Exception:
        # Never let telemetry failures leak into the response path.
        pass

    return ORJSONResponse(
        status_code=500,
        content=_envelope(
            code="internal_error",
            detail="An unexpected error occurred.",
            request_id=rid,
        ),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Register the full handler set on a FastAPI application."""
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(SQLAlchemyError, _sqlalchemy_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)

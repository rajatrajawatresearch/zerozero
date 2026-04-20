"""Structured logging configuration for ZeroZero API.

Implements the `zerozero_api.core.logging` contract from `docs/AGENT_CONTRACTS.md`.

Key behaviours:
  - ``configure_logging(env, level)`` wires ``structlog`` + stdlib ``logging``
    so every log record (from our code *or* third-party libs) flows through
    the same chain and ends up as a single structured entry.
  - In non-production environments we render with pretty colored console
    output. In production we render JSON (orjson-accelerated if available),
    which is what log aggregators want.
  - A module-level ``contextvar`` carrying the current request id is read on
    every log call so ``request_id`` appears automatically in every line.
  - ``get_logger(name)`` returns a standard ``structlog.stdlib.BoundLogger``.

The request-id contextvar lives in ``zerozero_api.core.middleware`` to keep
the middleware the single source of truth; we import it lazily to avoid a
circular import at module-load time.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog
from structlog.stdlib import BoundLogger
from structlog.types import EventDict, Processor

__all__ = ["configure_logging", "get_logger"]


def _inject_request_id(
    _logger: logging.Logger, _method_name: str, event_dict: EventDict
) -> EventDict:
    """Attach the current request id (if any) to every log record.

    Reads ``request_id_ctx`` from ``zerozero_api.core.middleware``. Imported
    lazily to sidestep the circular import between ``logging`` and
    ``middleware`` (middleware imports ``get_logger``).
    """
    try:
        from zerozero_api.core.middleware import request_id_ctx

        rid = request_id_ctx.get("")
    except Exception:
        rid = ""
    if rid:
        event_dict.setdefault("request_id", rid)
    return event_dict


def _json_serializer() -> Any:
    """Prefer orjson for speed, fall back to stdlib json."""
    try:
        import orjson

        def _dumps(obj: Any, default: Any = None) -> str:
            return orjson.dumps(obj, default=default).decode("utf-8")

        return _dumps
    except Exception:
        import json

        def _dumps_std(obj: Any, default: Any = None) -> str:
            return json.dumps(obj, default=default, separators=(",", ":"))

        return _dumps_std


def configure_logging(env: str, level: str = "INFO") -> None:
    """Configure ``structlog`` + stdlib ``logging`` for the whole process.

    Args:
        env: The deployment environment. Anything other than ``"production"``
            renders the pretty console output intended for local dev.
        level: A stdlib log level name, e.g. ``"INFO"``, ``"DEBUG"``.
    """
    log_level = getattr(logging, level.upper(), logging.INFO)
    is_production = env == "production"

    # Shared processor chain — same for structlog calls and for stdlib logs
    # that arrive via ProcessorFormatter.
    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        _inject_request_id,
    ]

    # Renderer: JSON in prod, pretty console otherwise.
    renderer: Processor
    if is_production:
        renderer = structlog.processors.JSONRenderer(serializer=_json_serializer())
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    # ---- structlog side ------------------------------------------------------
    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # ---- stdlib side: route all records through structlog's formatter --------
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    # Replace all pre-existing handlers so we're the only sink.
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(log_level)

    # Tame chatty libraries — keep warnings+ only.
    for noisy in ("uvicorn", "uvicorn.access", "uvicorn.error", "sqlalchemy.engine"):
        noisy_logger = logging.getLogger(noisy)
        noisy_logger.handlers = []
        noisy_logger.propagate = True
        noisy_logger.setLevel(
            logging.INFO if noisy in {"uvicorn", "uvicorn.error"} else logging.WARNING
        )


def get_logger(name: str) -> BoundLogger:
    """Return a structlog ``BoundLogger`` scoped to ``name``.

    Use this everywhere instead of ``logging.getLogger``.
    """
    return structlog.stdlib.get_logger(name)

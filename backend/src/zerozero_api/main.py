from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse

from zerozero_api import __version__
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from zerozero_api.core.db import dispose_engine, init_engine
from zerozero_api.core.errors import register_exception_handlers
from zerozero_api.core.logging import configure_logging, get_logger
from zerozero_api.core.middleware import AccessLogMiddleware, RequestIdMiddleware
from zerozero_api.core.ratelimit import limiter
from zerozero_api.routers.admin.menu_items import router as admin_menu_items_router
from zerozero_api.routers.admin.restaurants import router as admin_restaurants_router
from zerozero_api.routers.auth import router as auth_router
from zerozero_api.routers.categories import router as categories_router
from zerozero_api.routers.cuisines import router as cuisines_router
from zerozero_api.routers.geo import router as geo_router
from zerozero_api.routers.health import router as health_router
from zerozero_api.routers.restaurants import router as restaurants_router
from zerozero_api.routers.uploads import router as uploads_router
from zerozero_api.routers.users import router as users_router
from zerozero_api.settings import Settings, get_settings

# Configure logging at import time so every subsequent module log call is structured.
_settings: Settings = get_settings()
configure_logging(_settings.APP_ENV)
_logger = get_logger(__name__)


# -----------------------------------------------------------------------------
# OpenAPI metadata
# -----------------------------------------------------------------------------

OPENAPI_TAGS: list[dict[str, Any]] = [
    {"name": "health", "description": "Liveness and readiness probes."},
    {"name": "auth", "description": "Signup, login, refresh, logout, and current-user endpoints."},
    {"name": "users", "description": "Profile and saved addresses for the current user."},
    {"name": "restaurants", "description": "Public restaurant discovery, detail, and menus."},
    {"name": "search", "description": "Unified fuzzy search across restaurants and menu items."},
    {"name": "cart", "description": "Server-side cart persistence for the current user."},
    {"name": "orders", "description": "Order placement, history, detail, cancel, and review."},
    {"name": "promos", "description": "Promo code validation."},
    {"name": "payments", "description": "Mock payment gateway endpoints and webhooks."},
    {"name": "partner", "description": "Delivery-partner side: online status, location pings, order flow."},
    {"name": "admin", "description": "Owner/admin CRUD for restaurants and menu items."},
    {"name": "geo", "description": "Geocoding and reverse geocoding helpers."},
    {"name": "ws", "description": "WebSocket streams for orders, partner, and public tracking."},
]


# -----------------------------------------------------------------------------
# Lifespan
# -----------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Initialize and dispose shared async resources.

    The DB engine is owned by `zerozero_api.core.db` (separate agent). We just
    drive its lifecycle at app boundaries.
    """
    _logger.info("app.startup", env=_settings.APP_ENV, version=__version__)
    await init_engine()
    from zerozero_api.ws.connection_manager import manager as _ws_manager
    await _ws_manager.start_redis_subscriber()
    try:
        yield
    finally:
        await _ws_manager.stop()
        await dispose_engine()
        _logger.info("app.shutdown")


# -----------------------------------------------------------------------------
# App factory
# -----------------------------------------------------------------------------


def create_app() -> FastAPI:
    """Build and configure the FastAPI application instance."""
    settings = _settings

    # Sentry — only wire up when a DSN is configured.
    if settings.SENTRY_DSN:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.APP_ENV,
            release=f"{settings.APP_NAME}@{__version__}",
            traces_sample_rate=0.1,
            profiles_sample_rate=0.1,
            send_default_pii=False,
        )
        _logger.info("sentry.initialized", env=settings.APP_ENV)

    app = FastAPI(
        title=settings.APP_NAME,
        version=__version__,
        description=(
            "ZeroZero backend API — FastAPI + PostgreSQL/PostGIS + Redis + WebSockets. "
            "Zomato-style food-delivery clone with real-time order tracking, live "
            "delivery-partner location streaming, and dynamic theming."
        ),
        default_response_class=ORJSONResponse,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        openapi_tags=OPENAPI_TAGS,
        servers=[
            {"url": settings.APP_BASE_URL, "description": settings.APP_ENV},
        ],
        debug=settings.APP_DEBUG,
        lifespan=lifespan,
    )

    # ---- Middleware (outermost registered last runs first on the request) ----
    if settings.CORS_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.CORS_ORIGINS,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["X-Request-ID"],
        )

    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(AccessLogMiddleware)
    app.add_middleware(RequestIdMiddleware)

    # ---- Rate limiting (slowapi) --------------------------------------------
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

    # ---- Exception handlers -------------------------------------------------
    register_exception_handlers(app)

    # ---- Routers ------------------------------------------------------------
    app.include_router(health_router, prefix=settings.API_V1_PREFIX)
    app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
    app.include_router(users_router, prefix=settings.API_V1_PREFIX)
    app.include_router(uploads_router, prefix=settings.API_V1_PREFIX)
    app.include_router(geo_router, prefix=settings.API_V1_PREFIX)
    app.include_router(restaurants_router, prefix=settings.API_V1_PREFIX)
    app.include_router(cuisines_router, prefix=settings.API_V1_PREFIX)
    app.include_router(categories_router, prefix=settings.API_V1_PREFIX)
    app.include_router(admin_restaurants_router, prefix=settings.API_V1_PREFIX)
    app.include_router(admin_menu_items_router, prefix=settings.API_V1_PREFIX)

    # ---- PHASE 3 routers (each agent appends their own) ---------------------
    from zerozero_api.routers.payments import router as payments_router
    app.include_router(payments_router, prefix=settings.API_V1_PREFIX)
    from zerozero_api.routers.cart import router as cart_router
    app.include_router(cart_router, prefix=settings.API_V1_PREFIX)
    from zerozero_api.routers.promos import router as promos_router
    app.include_router(promos_router, prefix=settings.API_V1_PREFIX)
    from zerozero_api.routers.search import router as search_router
    app.include_router(search_router, prefix=settings.API_V1_PREFIX)
    from zerozero_api.routers.orders import router as orders_router; app.include_router(orders_router, prefix=settings.API_V1_PREFIX)
    from zerozero_api.routers.reviews import router as reviews_router; app.include_router(reviews_router, prefix=settings.API_V1_PREFIX)

    # ---- PHASE 4 WebSocket routers -----------------------------------------
    from zerozero_api.ws.orders import router as ws_orders_router
    app.include_router(ws_orders_router)
    from zerozero_api.ws.public import router as ws_public_router
    from zerozero_api.routers.public import router as public_router
    app.include_router(ws_public_router)
    app.include_router(public_router, prefix=settings.API_V1_PREFIX)
    from zerozero_api.ws.partner import router as ws_partner_router
    from zerozero_api.routers.partner import router as partner_router
    app.include_router(ws_partner_router)
    app.include_router(partner_router, prefix=settings.API_V1_PREFIX)
    from zerozero_api.routers.notifications import router as notifications_router; app.include_router(notifications_router, prefix=settings.API_V1_PREFIX)
    from zerozero_api.ws.notifications import router as ws_notifications_router; app.include_router(ws_notifications_router)

    # ---- Static files (local storage driver only) ---------------------------
    # When STORAGE_DRIVER=local, we serve uploaded images from disk via
    # StaticFiles so the LocalDisk-produced public URLs actually resolve.
    from fastapi.staticfiles import StaticFiles
    from pathlib import Path

    if settings.STORAGE_DRIVER == "local":
        upload_root = Path(settings.STORAGE_LOCAL_PATH).resolve()
        upload_root.mkdir(parents=True, exist_ok=True)
        app.mount("/uploads", StaticFiles(directory=str(upload_root)), name="uploads")

    return app


# Module-level app instance consumed by uvicorn: `zerozero_api.main:app`.
app: FastAPI = create_app()

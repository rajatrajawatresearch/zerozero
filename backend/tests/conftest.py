"""Shared pytest fixtures for the ZeroZero backend test suite.

Design goals
------------
1. **No mocks in integration tests** (see project CLAUDE.md rule #1). Real
   Postgres 16 + PostGIS 3.4 and real Redis 7 containers are spun up once per
   session via ``testcontainers``.
2. **Env vars overridden before** ``zerozero_api.settings.get_settings`` is ever
   called so the application code itself points at the containerized infra.
3. **Transactional test isolation** — every test runs inside a SAVEPOINT that
   is rolled back at teardown; the DB schema is created once per session and
   never torn down between tests.
4. **ASGI transport, not a live socket** — ``httpx.AsyncClient`` wraps the
   FastAPI app directly via ``ASGITransport``, which is the framework-
   recommended async test pattern.

Cross-agent imports
-------------------
This module imports lazily (inside fixtures) from:
  - ``zerozero_api.settings.get_settings``         (Agent 1)
  - ``zerozero_api.core.db``                       (Agent 2)
  - ``zerozero_api.domain.base.Base``              (Agent 6)
  - ``zerozero_api.main.app``                      (Agent 4 assembles it)

If ``zerozero_api.domain.base`` isn't available yet we fall back to whatever
``Base`` SQLAlchemy metadata the db module exposes — the fixture stays green
during partial-agent bring-up.
"""

from __future__ import annotations

import asyncio
import importlib
import os
from collections.abc import AsyncIterator, Iterator
from typing import TYPE_CHECKING, Any

import pytest
import pytest_asyncio

if TYPE_CHECKING:
    from fastapi import FastAPI
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession


# -----------------------------------------------------------------------------
# Container fixtures (session-scoped)
# -----------------------------------------------------------------------------


@pytest.fixture(scope="session")
def postgres_container() -> Iterator[str]:
    """Boot a PostGIS-enabled Postgres 16 container for the whole session.

    Yields the asyncpg-compatible SQLAlchemy URL.
    """
    from testcontainers.postgres import PostgresContainer

    # Image ships with PostGIS 3.4 + pg_trgm + uuid-ossp extensions available.
    container = PostgresContainer(
        image="postgis/postgis:16-3.4",
        username="zerozero",
        password="zerozero",
        dbname="zerozero_test",
    )
    container.start()
    try:
        # Normalize to the async driver. testcontainers returns a psycopg URL
        # like "postgresql+psycopg2://..." which SQLAlchemy async can't use.
        raw_url = container.get_connection_url()
        async_url = (
            raw_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
            .replace("postgresql+psycopg://", "postgresql+asyncpg://")
            .replace("postgresql://", "postgresql+asyncpg://")
        )
        yield async_url
    finally:
        container.stop()


@pytest.fixture(scope="session")
def redis_container() -> Iterator[str]:
    """Boot a Redis 7 container for the whole session and yield its URL."""
    from testcontainers.redis import RedisContainer

    container = RedisContainer(image="redis:7-alpine")
    container.start()
    try:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(6379)
        yield f"redis://{host}:{port}/0"
    finally:
        container.stop()


# -----------------------------------------------------------------------------
# Environment override — MUST run before any import of `zerozero_api.settings`
# by application code that we actually care about. We achieve this by:
#   1. Running before the `engine` fixture (which imports `zerozero_api.core.db`)
#   2. Clearing any cached Settings the moment env is finalized.
# -----------------------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def _override_env(
    postgres_container: str,
    redis_container: str,
) -> Iterator[None]:
    """Inject the container URLs into os.environ for the whole session."""
    # Compute a sync URL for Alembic / any psycopg-based consumer.
    sync_url = postgres_container.replace("postgresql+asyncpg://", "postgresql+psycopg://")

    previous: dict[str, str | None] = {}
    overrides = {
        "APP_ENV": "test",
        "APP_DEBUG": "false",
        "APP_NAME": "zerozero-api-test",
        "APP_HOST": "127.0.0.1",
        "APP_PORT": "8000",
        "APP_BASE_URL": "http://test",
        "API_V1_PREFIX": "/api/v1",
        "DATABASE_URL": postgres_container,
        "DATABASE_URL_SYNC": sync_url,
        "REDIS_URL": redis_container,
        "JWT_SECRET": "test-secret-do-not-use-in-prod-" + "x" * 32,
        "JWT_ALGORITHM": "HS256",
        "JWT_ACCESS_TTL_MINUTES": "15",
        "JWT_REFRESH_TTL_DAYS": "7",
        "CORS_ORIGINS": "http://test",
        "SENTRY_DSN": "",
        "NOMINATIM_BASE_URL": "https://nominatim.openstreetmap.org",
        "NOMINATIM_USER_AGENT": "zerozero-test",
        "STORAGE_DRIVER": "local",
        "STORAGE_LOCAL_PATH": "./.test-uploads",
    }
    for key, value in overrides.items():
        previous[key] = os.environ.get(key)
        os.environ[key] = value

    # Invalidate the lru_cache so the next get_settings() call re-reads env.
    try:
        from zerozero_api.settings import get_settings

        get_settings.cache_clear()
    except Exception:
        # Settings module might not be importable yet during very early
        # collection; ignore — fixtures that need it will import later.
        pass

    try:
        yield
    finally:
        # Restore any pre-existing env so external test runs aren't polluted.
        for key, old in previous.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old
        try:
            from zerozero_api.settings import get_settings

            get_settings.cache_clear()
        except Exception:
            pass


# -----------------------------------------------------------------------------
# Event loop — session-scoped so async fixtures can share it.
# -----------------------------------------------------------------------------


@pytest.fixture(scope="session")
def event_loop() -> Iterator[asyncio.AbstractEventLoop]:
    """Session-scoped event loop so session async fixtures stay bound."""
    loop = asyncio.new_event_loop()
    try:
        yield loop
    finally:
        loop.close()


# -----------------------------------------------------------------------------
# Engine + schema bootstrap
# -----------------------------------------------------------------------------


def _resolve_metadata() -> Any:
    """Return the SQLAlchemy MetaData that defines all app tables.

    Tries Agent 6's ``zerozero_api.domain.base.Base`` first. Falls back to a
    freshly-created empty ``DeclarativeBase`` so the fixture still works when
    the domain module hasn't landed yet (tests that don't need tables will
    still pass, tests that need models will error out clearly).
    """
    try:
        base_mod = importlib.import_module("zerozero_api.domain.base")
        base = getattr(base_mod, "Base", None)
        if base is not None and hasattr(base, "metadata"):
            # Importing domain submodules triggers model registration onto Base.
            try:
                importlib.import_module("zerozero_api.domain")
            except Exception:
                # Package might not be a package with explicit imports; OK.
                pass
            return base.metadata
    except Exception:
        pass

    from sqlalchemy.orm import DeclarativeBase

    class _FallbackBase(DeclarativeBase):
        pass

    return _FallbackBase.metadata


@pytest_asyncio.fixture(scope="session")
async def engine(_override_env: None) -> AsyncIterator[AsyncEngine]:
    """Build a fresh async engine wired to the test Postgres container.

    Reimports ``zerozero_api.core.db`` so the module-level engine picks up the
    overridden ``DATABASE_URL`` (the module captures settings at import time).
    Also provisions PostGIS + pg_trgm + uuid-ossp extensions before emitting
    DDL — geoalchemy2 columns require ``postgis`` to resolve ``geography``.
    """
    import sys

    # Force a reimport so the engine attaches to the test DB URL.
    for mod_name in ("zerozero_api.core.db",):
        sys.modules.pop(mod_name, None)

    db_mod = importlib.import_module("zerozero_api.core.db")
    async_engine: AsyncEngine = db_mod.engine

    from sqlalchemy import text

    # Extensions must exist before create_all runs any Geography column DDL.
    async with async_engine.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS postgis'))
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS pg_trgm'))
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))

    metadata = _resolve_metadata()

    async with async_engine.begin() as conn:
        await conn.run_sync(metadata.create_all)

    try:
        yield async_engine
    finally:
        await async_engine.dispose()


# -----------------------------------------------------------------------------
# Transactional session — each test runs inside a SAVEPOINT that rolls back.
# -----------------------------------------------------------------------------


@pytest_asyncio.fixture()
async def db_session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """Yield an ``AsyncSession`` wrapped in a nested transaction.

    Pattern: open an outer connection + transaction, bind a session to it with
    ``join_transaction_mode="create_savepoint"``, and roll back the whole outer
    transaction at teardown. This gives perfect per-test isolation without
    truncating tables.
    """
    from sqlalchemy.ext.asyncio import AsyncSession

    connection: AsyncConnection = await engine.connect()
    trans = await connection.begin()

    session = AsyncSession(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    try:
        yield session
    finally:
        await session.close()
        if trans.is_active:
            await trans.rollback()
        await connection.close()


# -----------------------------------------------------------------------------
# FastAPI app + async client
# -----------------------------------------------------------------------------


@pytest.fixture(scope="session")
def app(_override_env: None) -> FastAPI:
    """Import the FastAPI app *after* env overrides are in place."""
    import sys

    # Ensure a fresh import path; main.py captures settings at import time.
    for mod_name in (
        "zerozero_api.main",
        "zerozero_api.core.db",
        "zerozero_api.settings",
    ):
        sys.modules.pop(mod_name, None)

    main_mod = importlib.import_module("zerozero_api.main")
    return main_mod.app


@pytest_asyncio.fixture()
async def client(
    app: FastAPI,
    db_session: AsyncSession,
) -> AsyncIterator[AsyncClient]:
    """ASGI ``httpx.AsyncClient`` with ``get_db`` overridden to share the test session.

    Any FastAPI handler that depends on ``get_db`` will receive the same
    transactional session the test itself holds, so assertions and handler
    writes share state — and both get rolled back at teardown.
    """
    from httpx import ASGITransport, AsyncClient

    from zerozero_api.core.db import get_db

    async def _override_get_db() -> AsyncIterator[AsyncSession]:
        # Do not commit/rollback/close — the db_session fixture owns lifecycle.
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        try:
            yield ac
        finally:
            app.dependency_overrides.pop(get_db, None)

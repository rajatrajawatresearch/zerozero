"""Async SQLAlchemy engine, session factory, and FastAPI DB dependency.

Implements the `zerozero_api.core.db` contract defined in
`docs/AGENT_CONTRACTS.md`. Exposes:

  - ``engine``                — module-level ``AsyncEngine``
  - ``async_session_factory`` — ``async_sessionmaker[AsyncSession]``
  - ``get_db``                — FastAPI dependency yielding a session with
                                commit/rollback/close semantics
  - ``init_engine``           — pre-connect sanity check (app startup)
  - ``dispose_engine``        — graceful pool shutdown (app shutdown)
  - ``ping_db``               — ``SELECT 1`` health-check helper
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from zerozero_api.settings import get_settings

__all__ = [
    "engine",
    "async_session_factory",
    "get_db",
    "init_engine",
    "dispose_engine",
    "ping_db",
]


_settings = get_settings()

# Async SQLAlchemy engine. Uses asyncpg driver via the async DATABASE_URL.
# `pool_pre_ping` avoids stale connections after DB restarts.
engine: AsyncEngine = create_async_engine(
    _settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=5,
    echo=_settings.APP_DEBUG,
)

# Session factory — ``expire_on_commit=False`` keeps attributes usable after
# commit, which matches FastAPI response serialization patterns.
async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    """Yield a managed ``AsyncSession`` for FastAPI dependency injection.

    Semantics:
      - Commits on successful handler return.
      - Rolls back on any raised exception (then re-raises).
      - Always closes the session at the end.
    """
    session: AsyncSession = async_session_factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def init_engine() -> None:
    """Pre-warm the engine by opening a short-lived connection.

    Called on application startup (lifespan) so misconfiguration fails fast
    instead of surfacing on the first real request.
    """
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))


async def dispose_engine() -> None:
    """Dispose of the engine's connection pool. Called on app shutdown."""
    await engine.dispose()


async def ping_db() -> bool:
    """Return ``True`` if the database answers a ``SELECT 1``, else ``False``.

    Used by the ``/health`` endpoint. Never raises — any exception (network,
    auth, pool exhaustion) is swallowed and reported as an unhealthy DB.
    """
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False

"""Alembic migration environment — async-compatible.

Responsibilities:
  - Load the SQLAlchemy URL from ``zerozero_api.settings`` (synchronous URL,
    since Alembic's migration runner uses blocking DB-API under the hood).
  - Import ``zerozero_api.domain`` so every mapped class registers on the
    shared ``Base.metadata`` before autogenerate inspects it.
  - Filter PostGIS-internal tables/schemas out of autogenerate diffs so
    migrations stay focused on application tables.
  - Support both offline (URL-only) and online (engine-backed) modes; the
    online path uses ``AsyncEngine`` + ``run_sync`` per the official Alembic
    async template.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy import Connection, pool
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncEngine, async_engine_from_config

# Project imports. These must succeed when `prepend_sys_path` in alembic.ini
# includes the `src` directory.
from zerozero_api.settings import get_settings

# Import the declarative Base (Agent 6 owns this module).
from zerozero_api.domain.base import Base  # noqa: E402

# Side-effect import so every model module registers its tables on
# ``Base.metadata``. Without this, autogenerate will miss newly-added models.
import zerozero_api.domain  # noqa: F401,E402

# -----------------------------------------------------------------------------
# Alembic config + logging
# -----------------------------------------------------------------------------

config = context.config

# Configure Python logging from alembic.ini, if a config file path is set.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Inject the synchronous DATABASE URL at runtime. Alembic internals use
# a synchronous driver (psycopg) even when the app uses asyncpg, so we
# resolve the appropriate URL from settings here.
_settings = get_settings()
config.set_main_option("sqlalchemy.url", _settings.DATABASE_URL_SYNC)

# Autogenerate target.
target_metadata = Base.metadata


# -----------------------------------------------------------------------------
# Object / schema filters
# -----------------------------------------------------------------------------

# PostGIS installs a handful of helper tables / schemas we never want to
# include in our migrations.
_POSTGIS_TABLES = {"spatial_ref_sys"}
_POSTGIS_SCHEMAS = {"tiger", "tiger_data", "topology"}


def include_object(
    obj: Any,
    name: str,
    type_: str,
    reflected: bool,
    compare_to: Any,
) -> bool:
    """Filter out PostGIS-internal objects from autogenerate diffs."""
    if type_ == "table":
        if name in _POSTGIS_TABLES:
            return False
        schema = getattr(obj, "schema", None)
        if schema in _POSTGIS_SCHEMAS:
            return False
    if type_ == "schema" and name in _POSTGIS_SCHEMAS:
        return False
    return True


# Shared keyword arguments for ``context.configure`` across offline/online.
_CONFIGURE_COMMON: dict[str, Any] = {
    "target_metadata": target_metadata,
    "compare_type": True,
    "compare_server_default": True,
    "include_schemas": False,
    "include_object": include_object,
}


# -----------------------------------------------------------------------------
# Offline mode
# -----------------------------------------------------------------------------

def run_migrations_offline() -> None:
    """Run migrations against a URL only (no DB-API connection)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        **_CONFIGURE_COMMON,
    )
    with context.begin_transaction():
        context.run_migrations()


# -----------------------------------------------------------------------------
# Online mode (async-compatible)
# -----------------------------------------------------------------------------

def _do_run_migrations(connection: Connection) -> None:
    """Sync callback invoked on the underlying DBAPI connection."""
    context.configure(connection=connection, **_CONFIGURE_COMMON)
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    """Create an AsyncEngine, delegate migration run to a sync callback."""
    connectable: AsyncEngine = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        future=True,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(_do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Entry point for online migrations. Handles sync/async URLs gracefully.

    If the resolved URL is synchronous (e.g. ``postgresql+psycopg://``),
    fall back to the classic sync path so ``alembic upgrade head`` works
    without requiring an async driver.
    """
    url = config.get_main_option("sqlalchemy.url") or ""
    is_async_url = "+asyncpg" in url or "+aiosqlite" in url or "+asyncmy" in url

    if is_async_url:
        asyncio.run(_run_async_migrations())
        return

    # Synchronous fallback (psycopg / default drivers).
    from sqlalchemy import engine_from_config

    connectable: Engine = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        _do_run_migrations(connection)
    connectable.dispose()


# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

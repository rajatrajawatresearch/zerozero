"""Declarative base, naming convention, and shared mixins.

Every ORM class in ``zerozero_api.domain`` inherits from :class:`Base`.
The MetaData naming convention guarantees that Alembic auto-generates
stable, human-readable constraint names — this avoids churn in migration
diffs across machines/dialects.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

__all__ = ["Base", "TimestampMixin", "UUIDPk"]


# SQLAlchemy → Alembic constraint naming convention.
# See https://alembic.sqlalchemy.org/en/latest/naming.html
NAMING_CONVENTION: dict[str, str] = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Shared declarative base.

    All domain models subclass this. The fixed ``metadata`` carries our
    naming convention so generated constraint names stay deterministic.
    """

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UUIDPk:
    """Mixin providing a UUID primary key column.

    Uses the Postgres-native ``uuid`` type via ``dialects.postgresql.UUID``
    (``as_uuid=True`` makes SQLAlchemy return native ``uuid.UUID`` instances).
    Default is Python-side ``uuid4`` so ``RETURNING`` isn't required.
    """

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        nullable=False,
    )


class TimestampMixin:
    """Mixin adding ``created_at`` / ``updated_at`` timestamps.

    Both columns are timezone-aware. ``created_at`` uses a DB-side
    ``NOW()`` default so historical rows survive Python-side clock skew;
    ``updated_at`` additionally carries ``onupdate=func.now()`` so every
    mutation refreshes the value even when the application layer forgets.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

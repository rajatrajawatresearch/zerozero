"""Cuisine seeder.

Reads ``database/seed-data/cuisines.json`` and upserts each row keyed on
``slug``. Idempotent: re-running without ``--reset`` is a no-op on rows that
already exist.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Domain model provided by Agent 6 (`zerozero_api.domain.cuisine.Cuisine`).
# We import lazily inside the seed function to keep this module importable
# even if Agent 6 hasn't merged yet — the CLI surface and fixtures stay
# testable in isolation.
if TYPE_CHECKING:  # pragma: no cover - typing only
    pass

__all__ = ["SEED_FILE", "load_cuisines_fixture", "seed_cuisines"]


SEED_FILE: Path = (
    Path(__file__).resolve().parents[4] / "database" / "seed-data" / "cuisines.json"
)


def load_cuisines_fixture(path: Path | None = None) -> list[dict[str, Any]]:
    """Return parsed cuisine fixtures from disk.

    Exposed as a top-level helper so other seeders (restaurants.py) can
    resolve a cuisine slug → row dict without re-opening the file.
    """
    target = path or SEED_FILE
    with target.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):  # defensive: malformed fixture
        raise ValueError(f"Expected list in {target}, got {type(data).__name__}")
    return data


async def seed_cuisines(session: AsyncSession) -> dict[str, UUID]:
    """Seed the ``cuisines`` table and return a ``{slug: id}`` map.

    The map is consumed by :mod:`zerozero_api.seed.restaurants` to wire up
    the ``restaurant_cuisines`` many-to-many link without a second round
    trip per cuisine.
    """
    # Late import: domain models land in Phase 1 Agent 6's commit.
    from zerozero_api.domain.cuisine import Cuisine  # type: ignore[import-not-found]

    fixtures = load_cuisines_fixture()

    # Fetch existing rows once to keep this O(n) rather than N selects.
    existing_stmt = select(Cuisine)
    existing = {c.slug: c for c in (await session.scalars(existing_stmt)).all()}

    slug_to_id: dict[str, UUID] = {}

    for row in fixtures:
        slug = row["slug"]
        current = existing.get(slug)
        if current is None:
            cuisine = Cuisine(
                name=row["name"],
                slug=slug,
                icon=row.get("icon"),
                is_veg_only=row.get("is_veg_only", False),
            )
            session.add(cuisine)
            # Flush so `cuisine.id` is assigned (Python-side uuid4 default
            # makes this cheap — no RETURNING required).
            await session.flush()
            slug_to_id[slug] = cuisine.id
        else:
            slug_to_id[slug] = current.id

    return slug_to_id

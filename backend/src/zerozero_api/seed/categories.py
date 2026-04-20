"""Category seeder.

Reads ``database/seed-data/categories.json`` and upserts 12 global menu
categories (Recommended, Starters, Main Course, ...) keyed on ``slug``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

__all__ = ["SEED_FILE", "load_categories_fixture", "seed_categories"]


SEED_FILE: Path = (
    Path(__file__).resolve().parents[4] / "database" / "seed-data" / "categories.json"
)


def load_categories_fixture(path: Path | None = None) -> list[dict[str, Any]]:
    target = path or SEED_FILE
    with target.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise ValueError(f"Expected list in {target}, got {type(data).__name__}")
    return data


async def seed_categories(session: AsyncSession) -> dict[str, UUID]:
    """Seed the ``categories`` table and return a ``{slug: id}`` map."""
    from zerozero_api.domain.category import Category  # type: ignore[import-not-found]

    fixtures = load_categories_fixture()

    existing = {
        c.slug: c for c in (await session.scalars(select(Category))).all()
    }

    slug_to_id: dict[str, UUID] = {}

    for row in fixtures:
        slug = row["slug"]
        current = existing.get(slug)
        if current is None:
            category = Category(
                name=row["name"],
                slug=slug,
                icon=row.get("icon"),
                sort_order=row.get("sort_order", 0),
            )
            session.add(category)
            await session.flush()
            slug_to_id[slug] = category.id
        else:
            slug_to_id[slug] = current.id

    return slug_to_id

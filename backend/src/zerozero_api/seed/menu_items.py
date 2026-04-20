"""Menu-item seeder.

For every seeded restaurant:
    * Picks dish templates from ``database/seed-data/menu_templates.json``
      keyed by the restaurant's cuisine slugs.
    * Inserts 15-25 items with realistic price jitter (±15%).
    * ~20% of items receive a ``variants`` JSONB payload (e.g. pizza sizes).
"""

from __future__ import annotations

import json
import random
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

__all__ = ["TEMPLATES_FILE", "seed_menu_items"]


TEMPLATES_FILE: Path = (
    Path(__file__).resolve().parents[4]
    / "database"
    / "seed-data"
    / "menu_templates.json"
)


def _load_templates() -> dict[str, list[dict[str, Any]]]:
    with TEMPLATES_FILE.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"Expected dict in {TEMPLATES_FILE}")
    return data


def _variants_for(name: str, price: Decimal, category: str) -> list[dict[str, Any]]:
    """Produce a plausible variant list given an item name + category.

    We don't need perfect realism — just enough structure for the frontend
    ``MenuItemCard`` to demo "Small / Medium / Large" controls.
    """
    lowered = name.lower()
    if "pizza" in lowered:
        return [
            {"label": "Small (7\")", "price_delta": 0},
            {"label": "Medium (9\")", "price_delta": 120},
            {"label": "Large (12\")", "price_delta": 220},
        ]
    if "biryani" in lowered or category == "rice-biryani":
        return [
            {"label": "Regular", "price_delta": 0},
            {"label": "Family Pack", "price_delta": 180},
        ]
    if "burger" in lowered:
        return [
            {"label": "Single Patty", "price_delta": 0},
            {"label": "Double Patty", "price_delta": 90},
        ]
    if "coffee" in lowered or "chai" in lowered or category == "beverages":
        return [
            {"label": "Regular (250ml)", "price_delta": 0},
            {"label": "Large (400ml)", "price_delta": 40},
        ]
    # Generic small/large fallback.
    return [
        {"label": "Half", "price_delta": -30},
        {"label": "Full", "price_delta": 0},
    ]


async def seed_menu_items(
    session: AsyncSession,
    category_ids: dict[str, UUID],
    restaurants: list[tuple[UUID, list[str]]],
) -> int:
    """Seed menu items for every provided restaurant. Returns total rows.

    Idempotent at the restaurant level: if a restaurant already has menu
    items, we skip it. This means re-running without ``--reset`` never
    double-inserts.
    """
    from zerozero_api.domain.menu import MenuItem

    rng = random.Random(42)
    templates = _load_templates()

    # Default fallback category for templates referencing a slug we don't
    # happen to have (defensive — shouldn't fire in practice).
    fallback_category = category_ids.get("main-course") or next(iter(category_ids.values()))

    # Which restaurants already have items? Do it in one scan.
    existing_restaurant_ids = {
        row[0]
        for row in (
            await session.execute(
                select(MenuItem.restaurant_id).distinct()
            )
        ).all()
    }

    total_items = 0

    for restaurant_id, cuisine_slugs in restaurants:
        if restaurant_id in existing_restaurant_ids:
            continue

        # Pool of candidate items drawn from this restaurant's cuisines.
        pool: list[dict[str, Any]] = []
        for slug in cuisine_slugs:
            pool.extend(templates.get(slug, []))
        # Always salt with some desserts + beverages so menus feel complete.
        pool.extend(templates.get("desserts", [])[:3])
        pool.extend(templates.get("beverages", [])[:3])

        if not pool:
            continue

        # Deduplicate by (name, category) to avoid two identical entries.
        seen_keys: set[tuple[str, str]] = set()
        deduped: list[dict[str, Any]] = []
        for t in pool:
            key = (t["name"], t["category"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            deduped.append(t)

        rng.shuffle(deduped)
        target = rng.randint(15, 25)
        chosen = deduped[:target]
        # If pool is small, top up by repeating with suffixes so we still
        # hit at least 15.
        suffix_idx = 0
        suffixes = ["Classic", "Special", "Deluxe", "Signature", "Premium"]
        while len(chosen) < 15 and deduped:
            base = deduped[suffix_idx % len(deduped)]
            chosen.append(
                {
                    **base,
                    "name": f"{suffixes[suffix_idx % len(suffixes)]} {base['name']}",
                }
            )
            suffix_idx += 1

        for sort_idx, tpl in enumerate(chosen):
            category_id = category_ids.get(tpl["category"], fallback_category)
            base_price = int(tpl["price"])
            # ±15% price jitter so duplicate-named dishes differ by restaurant.
            jitter = rng.uniform(0.85, 1.15)
            price_int = max(49, int(round(base_price * jitter / 5.0) * 5))
            price = Decimal(price_int)

            tags: list[str] = list(tpl.get("tags", []))
            # 10% chance to promote an additional "bestseller" tag.
            if rng.random() < 0.10 and "bestseller" not in tags:
                tags.append("bestseller")

            variants = None
            if rng.random() < 0.20:
                variants = _variants_for(tpl["name"], price, tpl["category"])

            item = MenuItem(
                restaurant_id=restaurant_id,
                category_id=category_id,
                name=tpl["name"],
                description=f"{tpl['name']} — freshly prepared.",
                price=price,
                image_url=None,
                is_veg=bool(tpl.get("is_veg", True)),
                is_available=True,
                tags=tags,
                variants=variants,
                sort_order=sort_idx,
            )
            session.add(item)
            total_items += 1

    await session.flush()
    return total_items

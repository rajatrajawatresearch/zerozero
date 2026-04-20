"""Restaurant seeder.

Loads 10 hand-curated Delhi NCR restaurants from
``database/seed-data/restaurants_sample.json`` then generates ~40 additional
Faker-driven rows so the home feed feels alive. First 5 curated restaurants
are owned by the demo owner account.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from datetime import time
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from faker import Faker
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.seed.cuisines import load_cuisines_fixture
from zerozero_api.seed.utils import random_delhi_point, slugify, to_wkt

__all__ = [
    "SAMPLE_FILE",
    "SeededRestaurants",
    "seed_restaurants",
]


SAMPLE_FILE: Path = (
    Path(__file__).resolve().parents[4]
    / "database"
    / "seed-data"
    / "restaurants_sample.json"
)


@dataclass(slots=True)
class SeededRestaurants:
    """Return value of :func:`seed_restaurants`.

    Carries the per-restaurant cuisine slug list so the menu-item seeder can
    pick template dishes without re-reading the link table.
    """

    total: int
    curated_total: int
    generated_total: int
    restaurants: list[tuple[UUID, list[str]]]


_CURATED_CUISINE_PROFILES: list[tuple[str, list[str]]] = [
    # (suffix_flavor, cuisine_slugs) — used for Faker-generated restaurants.
    ("Kitchen", ["north-indian"]),
    ("Biryani House", ["biryani", "mughlai"]),
    ("Dhaba", ["north-indian", "street-food"]),
    ("Tandoor", ["mughlai", "north-indian"]),
    ("Dosa Corner", ["south-indian"]),
    ("Wok", ["chinese"]),
    ("Pizzeria", ["pizza", "italian"]),
    ("Burger Bar", ["burger", "fast-food"]),
    ("Cafe", ["continental", "bakery", "beverages"]),
    ("Sushi Bar", ["japanese"]),
    ("Thai Place", ["thai"]),
    ("Cantina", ["mexican"]),
    ("Sweets", ["desserts", "bakery"]),
    ("Juice Bar", ["healthy", "beverages", "vegan"]),
    ("Keto Cloud", ["keto", "healthy"]),
]


async def seed_restaurants(
    session: AsyncSession,
    cuisine_ids: dict[str, UUID],
    owner_user_id: UUID,
) -> SeededRestaurants:
    """Seed curated + generated restaurants. Idempotent on slug."""
    from zerozero_api.domain.restaurant import Restaurant, RestaurantCuisine

    fake = Faker("en_IN")
    Faker.seed(42)
    rng = random.Random(42)

    existing = {
        r.slug: r for r in (await session.scalars(select(Restaurant))).all()
    }

    # Restaurants we end up persisting this run — exclusive of
    # already-existing rows. Used when populating the M2M link.
    created: list[tuple[Restaurant, list[str]]] = []
    # All results (created + pre-existing) for callers.
    all_rows: list[tuple[UUID, list[str]]] = []

    # Build a quick slug → valid flag so Faker doesn't hand us a cuisine
    # that isn't in the DB.
    valid_slugs = set(cuisine_ids.keys())

    def _insert_restaurant(
        *,
        name: str,
        slug: str,
        description: str,
        cuisine_slugs: list[str],
        lat: float,
        lng: float,
        address_text: str,
        image_url: str | None,
        cover_url: str | None,
        owner_id: UUID | None,
        is_featured: bool,
        avg_prep_minutes: int,
    ) -> None:
        safe_cuisines = [s for s in cuisine_slugs if s in valid_slugs]
        if not safe_cuisines:
            # Fall back to a sensible default so the FK link is always
            # populated — callers can still filter in the UI.
            safe_cuisines = ["north-indian"] if "north-indian" in valid_slugs else [
                next(iter(valid_slugs))
            ]

        current = existing.get(slug)
        if current is not None:
            all_rows.append((current.id, safe_cuisines))
            return

        restaurant = Restaurant(
            owner_id=owner_id,
            name=name,
            slug=slug,
            description=description,
            location=f"SRID=4326;{to_wkt(lat, lng)}",
            address_text=address_text,
            delivery_radius_m=rng.randint(3000, 8000),
            min_order=Decimal(str(rng.choice([99, 149, 199, 249, 299]))),
            delivery_fee_base=Decimal(str(rng.choice([0, 19, 29, 39, 49]))),
            avg_prep_minutes=avg_prep_minutes,
            rating_avg=Decimal(f"{rng.uniform(3.5, 4.8):.1f}"),
            rating_count=rng.randint(20, 500),
            image_url=image_url,
            cover_url=cover_url,
            opens_at=time(hour=10, minute=0),
            closes_at=time(hour=23, minute=0),
            is_active=True,
            is_featured=is_featured,
        )
        session.add(restaurant)
        created.append((restaurant, safe_cuisines))

    # --- Curated ---------------------------------------------------------
    with SAMPLE_FILE.open("r", encoding="utf-8") as fh:
        curated: list[dict[str, Any]] = json.load(fh)

    for idx, row in enumerate(curated):
        _insert_restaurant(
            name=row["name"],
            slug=row["slug"],
            description=row["description"],
            cuisine_slugs=row["cuisines"],
            lat=row["lat"],
            lng=row["lng"],
            address_text=row["address_text"],
            image_url=row.get("image_url"),
            cover_url=row.get("cover_url"),
            # First 5 curated restaurants are owned by the demo owner.
            owner_id=owner_user_id if idx < 5 else None,
            is_featured=row.get("is_featured", False),
            avg_prep_minutes=row.get("avg_prep_minutes", 25),
        )

    # --- Generated -------------------------------------------------------
    generated_target = 40
    generated_done = 0
    attempts = 0
    used_slugs = set(existing.keys()) | {
        row["slug"] for row in curated
    }

    # Known cuisine fixtures (slug → dict) so we can read `is_veg_only`
    # when shaping random restaurants.
    cuisine_fixtures = {c["slug"]: c for c in load_cuisines_fixture()}

    while generated_done < generated_target and attempts < generated_target * 10:
        attempts += 1
        flavor_suffix, cuisine_slugs = rng.choice(_CURATED_CUISINE_PROFILES)
        base = fake.company().replace(",", "").replace(".", "")
        name = f"{base} {flavor_suffix}"
        slug = slugify(name)
        # Fake can collide on company names — bump with a numeric suffix.
        candidate = slug
        dedupe = 1
        while candidate in used_slugs:
            dedupe += 1
            candidate = f"{slug}-{dedupe}"
        slug = candidate
        used_slugs.add(slug)

        # 1–3 cuisines per restaurant.
        extra_pool = [c for c in valid_slugs if c not in cuisine_slugs]
        rng.shuffle(extra_pool)
        extras = extra_pool[: rng.randint(0, 2)]
        combined = list(dict.fromkeys([*cuisine_slugs, *extras]))[:3]

        # Veg-only restaurants skew toward veg-only cuisines.
        if all(cuisine_fixtures.get(c, {}).get("is_veg_only") for c in combined):
            # All chosen cuisines are veg-only — name nudge.
            name = f"{name} (Pure Veg)"

        lat, lng = random_delhi_point(rng=rng)
        image_slug = slug.replace("-", "_")
        _insert_restaurant(
            name=name,
            slug=slug,
            description=(
                f"{fake.catch_phrase()}. Serving {', '.join(combined)} flavours "
                f"across Delhi NCR since {rng.randint(2005, 2024)}."
            ),
            cuisine_slugs=combined,
            lat=lat,
            lng=lng,
            address_text=f"{fake.street_address()}, {fake.city()}, Delhi NCR",
            image_url=f"https://images.seeddata.zerozero.dev/restaurants/{image_slug}.jpg",
            cover_url=f"https://images.seeddata.zerozero.dev/restaurants/{image_slug}-cover.jpg",
            owner_id=None,
            is_featured=rng.random() < 0.15,
            avg_prep_minutes=rng.randint(15, 45),
        )
        generated_done += 1

    # Flush so every created Restaurant has an ID.
    await session.flush()

    # Populate the restaurant_cuisines link table for freshly-created rows.
    for restaurant, cuisine_slugs in created:
        for slug in cuisine_slugs:
            session.add(
                RestaurantCuisine(
                    restaurant_id=restaurant.id,
                    cuisine_id=cuisine_ids[slug],
                )
            )
        all_rows.append((restaurant.id, cuisine_slugs))

    await session.flush()

    return SeededRestaurants(
        total=len(all_rows),
        curated_total=len(curated),
        generated_total=generated_done,
        restaurants=all_rows,
    )

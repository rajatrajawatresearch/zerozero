"""Seed orchestrator.

Opens an async session from :mod:`zerozero_api.core.db`, optionally wipes
all non-extension tables in dependency order via ``TRUNCATE ... RESTART
IDENTITY CASCADE``, and runs each seeder in the correct order so FK
constraints are always satisfied:

    cuisines → categories → users → restaurants → menu_items → promos
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.db import async_session_factory, dispose_engine, init_engine
from zerozero_api.seed.categories import seed_categories
from zerozero_api.seed.cuisines import seed_cuisines
from zerozero_api.seed.menu_items import seed_menu_items
from zerozero_api.seed.promos import seed_promos
from zerozero_api.seed.restaurants import seed_restaurants
from zerozero_api.seed.users import seed_users

__all__ = ["SEED_STAGES", "SeedSummary", "run_seed"]

log = structlog.get_logger(__name__)


# All non-extension tables in dependency order (leaves first).
# TRUNCATE ... CASCADE would handle FKs on its own, but an explicit order
# is still more readable and surfaces the dependency graph.
TRUNCATE_ORDER: tuple[str, ...] = (
    "order_status_events",
    "order_items",
    "orders",
    "cart_items",
    "partner_locations",
    "delivery_partners",
    "reviews",
    "notifications",
    "menu_items",
    "restaurant_cuisines",
    "restaurants",
    "addresses",
    "refresh_tokens",
    "users",
    "categories",
    "cuisines",
    "promo_codes",
    "theme_presets",
)

# Names used by the `--only` flag. Keep the canonical order here.
SEED_STAGES: tuple[str, ...] = (
    "cuisines",
    "categories",
    "users",
    "restaurants",
    "menu_items",
    "promos",
)


@dataclass(slots=True)
class SeedSummary:
    """Per-stage counts + metadata returned by :func:`run_seed`."""

    stages_run: list[str] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)
    reset: bool = False

    def add(self, stage: str, count: int) -> None:
        self.stages_run.append(stage)
        self.counts[stage] = count


async def _truncate_all(session: AsyncSession) -> None:
    """Drop all seedable table contents via a single TRUNCATE statement.

    Using one statement (instead of many) lets Postgres resolve the FK
    graph once and resets every identity sequence together.
    """
    tables = ", ".join(TRUNCATE_ORDER)
    await session.execute(
        text(f"TRUNCATE TABLE {tables} RESTART IDENTITY CASCADE")
    )
    log.info("seed.truncate.done", tables=len(TRUNCATE_ORDER))


async def run_seed(
    *,
    reset: bool = False,
    only: list[str] | None = None,
) -> SeedSummary:
    """Run the seed pipeline.

    Parameters
    ----------
    reset
        If True, TRUNCATE all seed tables before inserting. Implies every
        stage runs regardless of ``only`` scoping for the reset step, but
        ``only`` still scopes which seeders execute after the wipe.
    only
        Optional stage filter, e.g. ``["restaurants", "menu_items"]``. If
        omitted, all stages run. Stages named in ``only`` that aren't in
        :data:`SEED_STAGES` are ignored with a warning.
    """
    await init_engine()
    summary = SeedSummary(reset=reset)

    # Resolve the stage set once, preserving canonical order.
    if only:
        requested = {s.strip() for s in only if s.strip()}
        unknown = requested - set(SEED_STAGES)
        for s in unknown:
            log.warning("seed.stage.unknown", stage=s)
        stages_to_run = [s for s in SEED_STAGES if s in requested]
    else:
        stages_to_run = list(SEED_STAGES)

    if not stages_to_run:
        log.warning("seed.nothing_to_run")
        await dispose_engine()
        return summary

    # These are state handoffs between stages. They're scoped here so stages
    # skipped by `--only` don't cause KeyError lookups downstream.
    cuisine_ids: dict[str, Any] = {}
    category_ids: dict[str, Any] = {}
    owner_id: Any = None
    restaurant_rows: list[tuple[Any, list[str]]] = []

    try:
        async with async_session_factory() as session:
            if reset:
                await _truncate_all(session)

            # Each lambda below is a thin adapter so the dispatch table is
            # uniform. We intentionally keep the mapping here (as opposed
            # to in each submodule) so the runner is the single source of
            # truth for stage order + dependencies.
            async def run_cuisines() -> int:
                nonlocal cuisine_ids
                cuisine_ids = await seed_cuisines(session)
                return len(cuisine_ids)

            async def run_categories() -> int:
                nonlocal category_ids
                category_ids = await seed_categories(session)
                return len(category_ids)

            async def run_users() -> int:
                nonlocal owner_id
                result = await seed_users(session)
                owner_id = result.owner_id
                return result.total

            async def run_restaurants() -> int:
                nonlocal restaurant_rows
                if not cuisine_ids or owner_id is None:
                    # If the user scoped ``--only restaurants`` without
                    # cuisines/users already seeded, pull what's there.
                    from zerozero_api.domain.cuisine import (  # type: ignore[import-not-found]
                        Cuisine,
                    )
                    from zerozero_api.domain.user import (  # type: ignore[import-not-found]
                        User,
                    )
                    from sqlalchemy import select

                    if not cuisine_ids:
                        cuisine_ids.update(
                            {
                                c.slug: c.id
                                for c in (
                                    await session.scalars(select(Cuisine))
                                ).all()
                            }
                        )
                    if owner_id is None:
                        owner = (
                            await session.execute(
                                select(User).where(User.email == "owner@test.com")
                            )
                        ).scalar_one_or_none()
                        owner_id = owner.id if owner else None

                if owner_id is None:
                    raise RuntimeError(
                        "seed stage 'restaurants' needs an owner user — "
                        "run the 'users' stage first."
                    )
                result = await seed_restaurants(session, cuisine_ids, owner_id)
                restaurant_rows = result.restaurants
                return result.total

            async def run_menu_items() -> int:
                nonlocal category_ids, restaurant_rows
                if not category_ids or not restaurant_rows:
                    from sqlalchemy import select

                    from zerozero_api.domain.category import (  # type: ignore[import-not-found]
                        Category,
                    )
                    from zerozero_api.domain.restaurant import (  # type: ignore[import-not-found]
                        Restaurant,
                    )

                    if not category_ids:
                        category_ids.update(
                            {
                                c.slug: c.id
                                for c in (
                                    await session.scalars(select(Category))
                                ).all()
                            }
                        )
                    if not restaurant_rows:
                        restaurant_rows = [
                            (r.id, [])
                            for r in (
                                await session.scalars(select(Restaurant))
                            ).all()
                        ]

                return await seed_menu_items(session, category_ids, restaurant_rows)

            async def run_promos() -> int:
                return await seed_promos(session)

            dispatch: dict[str, Callable[[], Awaitable[int]]] = {
                "cuisines": run_cuisines,
                "categories": run_categories,
                "users": run_users,
                "restaurants": run_restaurants,
                "menu_items": run_menu_items,
                "promos": run_promos,
            }

            for stage in stages_to_run:
                log.info("seed.stage.start", stage=stage)
                count = await dispatch[stage]()
                summary.add(stage, count)
                log.info("seed.stage.done", stage=stage, count=count)

            await session.commit()
    finally:
        await dispose_engine()

    log.info(
        "seed.complete",
        reset=reset,
        stages=summary.stages_run,
        counts=summary.counts,
    )
    return summary

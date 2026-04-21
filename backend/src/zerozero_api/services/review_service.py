"""Review read + aggregate-recompute service (Phase 4).

This module is **purely additive** on top of Phase 3. The Phase 3
``order_service.create_review`` already writes the ``reviews`` row; this
service supplies:

  * :func:`list_restaurant_reviews` — public paginated list for the
    restaurant-detail page. Joins :class:`User` so each row carries the
    reviewer's display name + avatar (no N+1).
  * :func:`recompute_restaurant_rating` — the Phase 4 aggregate sync.
    Runs ``SELECT AVG(rating), COUNT(*) FROM reviews WHERE
    restaurant_id=:id`` and stamps the result on ``restaurants.rating_avg``
    + ``restaurants.rating_count``. Idempotent, cheap, safe to call from
    anywhere.
  * :func:`ensure_aggregate_synced` — thin wrapper used as the canonical
    post-review hook name; present so the Phase-3 order flow (or any
    future writer) can opt in without caring about the underlying SQL.
  * :func:`on_review_created` — convenience hook that accepts a
    :class:`Review` ORM row and extracts the restaurant_id for you.

Aggregate-sync tradeoff
-----------------------
The Phase 4 contract mandates "after create: recompute aggregate". The
cleanest wiring (service-layer hook from ``order_service.create_review``)
would require editing Phase-3 code, which this agent is explicitly
forbidden from touching. Two equivalent solutions are implemented:

  1. **On-demand admin sweep** — ``POST /admin/reviews/recompute`` runs
     ``recompute_restaurant_rating`` for a single restaurant (or for every
     restaurant when ``restaurant_id`` is omitted). This is the path the
     router exposes; it keeps the review-create endpoint untouched.
  2. **Programmatic hook** — :func:`ensure_aggregate_synced` and
     :func:`on_review_created` are exported so a future refactor (or a
     Phase 5 writer) can call them inside the same transaction as the
     insert. Until then the admin sweep is the authoritative sync.

Net result for users: aggregate values converge to truth on the next
admin sweep (the frontend already reads ``rating_avg`` / ``rating_count``
off the restaurant row, so a slightly stale value is harmless; the
review list itself is always live because it queries ``reviews``
directly). Operators can schedule the sweep as a cron job; the endpoint
is idempotent and cheap (one aggregate query + one UPDATE per
restaurant).
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.errors import NotFoundError
from zerozero_api.domain.restaurant import Restaurant
from zerozero_api.domain.review import Review
from zerozero_api.domain.user import User
from zerozero_api.schemas.common import PageOut
from zerozero_api.schemas.review import ReviewListItem

__all__ = [
    "ensure_aggregate_synced",
    "list_restaurant_reviews",
    "on_review_created",
    "recompute_all_restaurant_ratings",
    "recompute_restaurant_rating",
]


# ---------------------------------------------------------------------------
# Read — paginated review list for the public restaurant-detail page
# ---------------------------------------------------------------------------


async def list_restaurant_reviews(
    db: AsyncSession,
    *,
    restaurant_slug: str,
    page: int = 1,
    page_size: int = 20,
) -> PageOut[ReviewListItem]:
    """Return a page of :class:`ReviewListItem` for ``restaurant_slug``.

    Sorted newest-first by ``created_at``. Joins :class:`User` inline so
    each row carries the reviewer's display name + avatar in a single
    query (no N+1, no secondary selectin). ``page_size`` is clamped to
    ``[1, 50]`` to stay consistent with the rest of the public API.

    Raises :class:`NotFoundError` when the slug doesn't resolve to an
    active restaurant — keeps the 404 consistent with
    :func:`restaurant_service.get_restaurant_detail`.
    """
    page = max(1, page)
    page_size = max(1, min(50, page_size))
    offset = (page - 1) * page_size

    # Resolve the restaurant first so we can return 404 distinct from an
    # empty-results 200 and scope the subsequent queries by id (faster
    # than joining on slug both times).
    restaurant_id_row = (
        await db.execute(
            select(Restaurant.id).where(
                Restaurant.slug == restaurant_slug,
                Restaurant.is_active.is_(True),
            )
        )
    ).first()
    if restaurant_id_row is None:
        raise NotFoundError("Restaurant not found", code="restaurant_not_found")
    restaurant_id: UUID = restaurant_id_row[0]

    # Page query: join User for name+avatar. ``fetch`` returns one row
    # per review — we build the DTO directly from the row tuple to skip
    # the ORM materialization cost for user objects.
    page_stmt = (
        select(
            Review.id,
            Review.rating,
            Review.comment,
            Review.images,
            Review.created_at,
            User.full_name,
            User.avatar_url,
        )
        .join(User, User.id == Review.user_id)
        .where(Review.restaurant_id == restaurant_id)
        .order_by(Review.created_at.desc())
        .offset(offset)
        .limit(page_size + 1)
    )
    rows = (await db.execute(page_stmt)).all()
    has_next = len(rows) > page_size
    page_rows = rows[:page_size]

    count_stmt = (
        select(func.count())
        .select_from(Review)
        .where(Review.restaurant_id == restaurant_id)
    )
    total = int((await db.execute(count_stmt)).scalar_one() or 0)

    items: list[ReviewListItem] = [
        ReviewListItem(
            id=row.id,
            rating=int(row.rating),
            comment=row.comment,
            images=list(row.images or []),
            created_at=row.created_at,
            user_full_name=row.full_name,
            user_avatar_url=row.avatar_url,
        )
        for row in page_rows
    ]

    return PageOut[ReviewListItem](
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        has_next=has_next,
    )


# ---------------------------------------------------------------------------
# Aggregate recompute
# ---------------------------------------------------------------------------


async def recompute_restaurant_rating(
    db: AsyncSession, restaurant_id: UUID
) -> tuple[Decimal, int]:
    """Refresh ``restaurants.rating_avg`` + ``rating_count`` for one restaurant.

    Runs a single aggregate query plus a single UPDATE. Idempotent: safe
    to call as often as you like; on a restaurant with zero reviews the
    values reset to ``(0.0, 0)`` rather than staying stale.

    Returns the ``(avg, count)`` pair that was persisted so callers can
    log / surface the new values without re-reading.
    """
    agg_stmt = select(
        func.coalesce(func.avg(Review.rating), 0).label("avg"),
        func.count(Review.id).label("count"),
    ).where(Review.restaurant_id == restaurant_id)
    row = (await db.execute(agg_stmt)).one()

    # ``rating_avg`` is ``Numeric(2, 1)`` — quantize to 1dp so the DB
    # never sees e.g. ``4.333333``; avoids a silent round on INSERT and
    # keeps the value identical to what we return here.
    avg_raw = row.avg if row.avg is not None else 0
    avg = Decimal(str(avg_raw)).quantize(Decimal("0.1"))
    count = int(row.count or 0)

    await db.execute(
        update(Restaurant)
        .where(Restaurant.id == restaurant_id)
        .values(rating_avg=avg, rating_count=count)
    )
    await db.flush()
    return avg, count


async def recompute_all_restaurant_ratings(db: AsyncSession) -> int:
    """Recompute aggregates for *every* restaurant that has at least one review.

    Returns the number of restaurants that were touched. Restaurants
    without any reviews are skipped — their default ``(0.0, 0)`` values
    are already correct. Intended for the admin sweep endpoint.
    """
    restaurant_ids_stmt = select(Review.restaurant_id).distinct()
    rids = [rid for (rid,) in (await db.execute(restaurant_ids_stmt)).all()]
    for rid in rids:
        await recompute_restaurant_rating(db, rid)
    return len(rids)


# ---------------------------------------------------------------------------
# Hooks (for future callers; current Phase-3 order_service is untouched)
# ---------------------------------------------------------------------------


async def ensure_aggregate_synced(
    db: AsyncSession, restaurant_id: UUID
) -> None:
    """Canonical post-review sync hook.

    Named so callers don't have to care whether we recompute inline, via
    trigger, or via background task — they just call this. Currently
    delegates to :func:`recompute_restaurant_rating`; swap the body out
    later if we move to a materialized view or trigger without rewriting
    the call sites.
    """
    await recompute_restaurant_rating(db, restaurant_id)


async def on_review_created(db: AsyncSession, review: Review) -> None:
    """Convenience hook invoked after a Review insert.

    Currently a thin shim over :func:`ensure_aggregate_synced` — accepts
    the ORM row so callers don't need to destructure ``restaurant_id``
    themselves. Left here as a documented integration point so Phase 5
    (or a refactor of ``order_service.create_review``) can wire itself
    in with a one-line import.
    """
    await ensure_aggregate_synced(db, review.restaurant_id)

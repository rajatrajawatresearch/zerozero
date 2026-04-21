/**
 * `ReviewList` — scrollable, paginated list of a restaurant's reviews.
 *
 * Mounted inside `RestaurantDetailPage` after the menu. Reads the slug from
 * props (parent already has it from `useParams`) so this component stays
 * route-agnostic and unit-testable in isolation.
 *
 * Paging strategy: `useInfiniteQuery` under the hood; first page loads eagerly
 * on mount, subsequent pages behind a "Load more" button. Deferred in a
 * viewport-aware variant is a Phase 5 enhancement — the button keeps the
 * implementation contract-tight for Phase 4.
 *
 * Empty / error / loading all have first-class states — no silent failures.
 *
 * The optional `aggregate` prop lets the parent (RestaurantDetailPage) hand
 * in the pre-fetched `rating_avg` + `rating_count` so the header doesn't
 * blink when reviews paginate in.
 */
import { AlertCircle, Loader2, MessageSquare } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useRestaurantReviewsQuery } from '../api';
import type { ReviewOut } from '../types';
import { AggregateRating } from './AggregateRating';
import { ReviewCard } from './ReviewCard';

/* -------------------------------------------------------------------------- */
/*                                    Props                                   */
/* -------------------------------------------------------------------------- */
export interface ReviewListProps {
  /** Restaurant slug from the URL (e.g. `burger-king-koramangala`). */
  restaurantSlug: string;
  /**
   * Pre-computed aggregate from the restaurant detail response. Keeps the
   * header stable while reviews paginate. When omitted, the component
   * derives a count from the loaded pages — handy for dev / storybook.
   */
  aggregate?: { rating_avg: number | string; rating_count: number };
  /** Tune page size for dense vs roomy layouts. Defaults to 10. */
  pageSize?: number;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function ReviewList({
  restaurantSlug,
  aggregate,
  pageSize = 10,
}: ReviewListProps): React.ReactElement {
  const query = useRestaurantReviewsQuery(restaurantSlug, { pageSize });

  const reviews: ReviewOut[] = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  // Derive a fallback count from the loaded pages when the caller didn't
  // pass an aggregate. Preferring the server-provided `total` keeps the
  // number accurate even though only some pages are loaded client-side.
  const derivedAggregate = useMemo(() => {
    if (aggregate) return aggregate;
    const total = query.data?.pages[0]?.total ?? reviews.length;
    const avg =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;
    return { rating_avg: avg, rating_count: total };
  }, [aggregate, query.data, reviews]);

  /* --------------------------- Loading (first page) ----------------------- */
  if (query.isLoading) {
    return (
      <section
        aria-label="Customer reviews"
        className="flex flex-col gap-4"
        data-slot="review-list"
      >
        <h2 className="text-xl font-bold">Reviews</h2>
        <Skeleton className="h-20 w-full rounded-lg" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <ReviewSkeleton key={i} />
          ))}
        </div>
      </section>
    );
  }

  /* ------------------------------- Error ---------------------------------- */
  if (query.isError) {
    return (
      <section aria-label="Customer reviews" className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Reviews</h2>
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>Could not load reviews. Please try again.</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </section>
    );
  }

  /* ------------------------------- Empty ---------------------------------- */
  if (reviews.length === 0) {
    return (
      <section aria-label="Customer reviews" className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Reviews</h2>
        <AggregateRating
          value={derivedAggregate.rating_avg}
          count={derivedAggregate.rating_count}
        />
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 py-10 text-center">
          <MessageSquare className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">No reviews yet.</p>
        </div>
      </section>
    );
  }

  /* ----------------------------- Happy path ------------------------------- */
  return (
    <section
      aria-label="Customer reviews"
      className="flex flex-col gap-4"
      data-slot="review-list"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Reviews</h2>
      </div>

      <AggregateRating
        value={derivedAggregate.rating_avg}
        count={derivedAggregate.rating_count}
      />

      <ul className="flex flex-col gap-3" role="list">
        {reviews.map((review) => (
          <li key={review.id}>
            <ReviewCard review={review} />
          </li>
        ))}
      </ul>

      {query.hasNextPage ? (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void query.fetchNextPage();
            }}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading
              </>
            ) : (
              'Load more reviews'
            )}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Skeleton row                                */
/* -------------------------------------------------------------------------- */
function ReviewSkeleton(): React.ReactElement {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      aria-hidden
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

export default ReviewList;

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useRestaurantsQuery } from '../api';
import type { RestaurantCard as RestaurantCardDto, RestaurantListParams } from '../types';
import { RestaurantCard } from './RestaurantCard';
import { RestaurantCardSkeleton } from './RestaurantCardSkeleton';

/**
 * Responsive restaurant grid with manual "load more" pagination.
 *
 * Consumption:
 *   - The list page (Agent 10's HomePage too) owns the filters/location
 *     state and passes the fully-resolved `params` down. This component
 *     stays dumb about where lat/lng or cuisine filters come from.
 *
 * Behaviour:
 *   - Initial load shows 6 layout-matched skeletons
 *   - "Load more" fetches the next page and appends into local state so the
 *     user doesn't lose their scroll position on each page change
 *   - An IntersectionObserver auto-triggers load-more when the sentinel
 *     scrolls into view, with a manual Button as a11y fallback
 */
interface RestaurantGridProps {
  /** Base query params (cuisine, q, veg, sort, lat, lng). `page` / `pageSize` managed internally. */
  params: Omit<RestaurantListParams, 'page' | 'pageSize'>;
  pageSize?: number;
  className?: string;
  /** Rendered when the first page returns zero items. */
  emptyState?: React.ReactNode;
}

const DEFAULT_PAGE_SIZE = 12;

export function RestaurantGrid({
  params,
  pageSize = DEFAULT_PAGE_SIZE,
  className,
  emptyState,
}: RestaurantGridProps) {
  const [page, setPage] = useState(1);
  // Accumulator across pages. Cleared whenever the serialised filter key changes.
  const [accumulated, setAccumulated] = useState<RestaurantCardDto[]>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const paramsKey = useMemo(() => JSON.stringify(params), [params]);

  // Reset pagination whenever filters change.
  useEffect(() => {
    setPage(1);
    setAccumulated([]);
  }, [paramsKey]);

  const queryParams = useMemo<RestaurantListParams>(
    () => ({ ...params, page, pageSize }),
    [params, page, pageSize],
  );

  const { data, isLoading, isFetching, isError, error, refetch } =
    useRestaurantsQuery(queryParams);

  // Merge each successful page into the accumulator. Guard against duplicate
  // merges caused by StrictMode's double-invoke in dev.
  useEffect(() => {
    if (!data) return;
    setAccumulated((prev) => {
      if (data.page === 1) return data.items;
      const seen = new Set(prev.map((r) => r.id));
      const fresh = data.items.filter((r) => !seen.has(r.id));
      return prev.concat(fresh);
    });
  }, [data]);

  // Auto-load on sentinel visibility (progressive enhancement — the button
  // below is the a11y-first path and still works if IO is unsupported).
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !data?.has_next || isFetching) return;

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [data?.has_next, isFetching]);

  /* ----------------------------- Render states ---------------------------- */
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-10 text-center">
        <AlertCircle className="size-6 text-destructive" aria-hidden />
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : 'Failed to load restaurants.'}
        </p>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const showInitialSkeletons = isLoading && accumulated.length === 0;

  if (!showInitialSkeletons && accumulated.length === 0 && !isFetching) {
    return <>{emptyState}</>;
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {showInitialSkeletons
          ? Array.from({ length: 6 }).map((_, i) => (
              <RestaurantCardSkeleton key={`sk-${i}`} />
            ))
          : accumulated.map((r) => <RestaurantCard key={r.id} restaurant={r} />)}

        {/* Inline skeletons while appending a new page */}
        {isFetching && accumulated.length > 0 && data?.page !== page
          ? Array.from({ length: 3 }).map((_, i) => (
              <RestaurantCardSkeleton key={`sk-more-${i}`} />
            ))
          : null}
      </div>

      {data?.has_next ? (
        <div ref={sentinelRef} className="flex justify-center py-4">
          <Button
            variant="outline"
            onClick={() => setPage((p) => p + 1)}
            disabled={isFetching}
          >
            {isFetching ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading
              </>
            ) : (
              'Load more'
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default RestaurantGrid;

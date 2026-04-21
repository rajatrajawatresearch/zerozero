import type { ReactElement } from 'react';
import { Star } from 'lucide-react';

import type { RestaurantCard as RestaurantCardDto } from '@/features/restaurants/types';
import { cn } from '@/lib/utils';

/**
 * Single-row restaurant hit used inside the Command palette and on the
 * full `/search` page. Deliberately lean — just enough to identify the
 * restaurant without pulling in the full `RestaurantCard` tile.
 *
 * The parent (Command palette / SearchPage) owns navigation on select,
 * so this component is purely presentational.
 */
interface SearchResultRestaurantProps {
  restaurant: RestaurantCardDto;
  className?: string;
}

export function SearchResultRestaurant({
  restaurant: r,
  className,
}: SearchResultRestaurantProps): ReactElement {
  const cuisines = r.cuisines.slice(0, 3).map((c) => c.name).join(' • ');
  const rating = Number(r.rating_avg);
  const hasRating = r.rating_count > 0 && Number.isFinite(rating);

  return (
    <div className={cn('flex w-full items-center gap-3', className)}>
      <div className="size-10 shrink-0 overflow-hidden rounded-md bg-muted">
        {r.cover_url ? (
          <img
            src={r.cover_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-muted-foreground"
          >
            {r.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {r.name}
          </span>
          {!r.is_open ? (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Closed
            </span>
          ) : null}
        </div>
        {cuisines ? (
          <p className="truncate text-xs text-muted-foreground">{cuisines}</p>
        ) : null}
      </div>

      {hasRating ? (
        <div className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
          <Star className="size-3 fill-current" aria-hidden />
          <span>{rating.toFixed(1)}</span>
        </div>
      ) : null}
    </div>
  );
}

export default SearchResultRestaurant;

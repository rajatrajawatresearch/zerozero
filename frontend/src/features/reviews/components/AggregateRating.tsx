/**
 * Big "4.3★ (213 reviews)" summary block that sits at the top of the reviews
 * section. Purely presentational — consumer passes pre-computed numbers
 * (typically from the restaurant detail endpoint) so this component stays
 * cache-free.
 *
 * Visual parity with `RatingBadge` from the restaurants slice: both use the
 * same warning-tinted star icon and Indian-locale number formatting.
 */
import { Star } from 'lucide-react';

import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*                                    Props                                   */
/* -------------------------------------------------------------------------- */
export interface AggregateRatingProps {
  /** Decimal-string or number — backend ships string, RestaurantDetail as number. */
  value: string | number;
  count: number;
  className?: string;
}

/** Reuse the same formatter used by RatingBadge for consistency. */
const COUNT_FORMATTER = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function AggregateRating({
  value,
  count,
  className,
}: AggregateRatingProps): React.ReactElement {
  const numeric = typeof value === 'number' ? value : Number(value);
  const safe = Number.isFinite(numeric) ? numeric : 0;

  if (count === 0) {
    return (
      <div
        className={cn(
          'flex flex-col gap-0.5 rounded-lg border border-border bg-card p-4',
          className,
        )}
      >
        <p className="text-sm font-medium text-foreground">No reviews yet</p>
        <p className="text-xs text-muted-foreground">
          Be the first to share your experience.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-lg border border-border bg-card p-4',
        className,
      )}
      aria-label={`Rated ${safe.toFixed(1)} out of 5 based on ${count} reviews`}
    >
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold leading-none text-foreground">
          {safe.toFixed(1)}
        </span>
        <Star className="size-6 fill-warning text-warning" aria-hidden />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-foreground">
          {count < 5 ? 'Early ratings' : safe >= 4 ? 'Loved by diners' : 'Mixed reviews'}
        </span>
        <span className="text-xs text-muted-foreground">
          Based on {COUNT_FORMATTER.format(count)} review{count === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

export default AggregateRating;

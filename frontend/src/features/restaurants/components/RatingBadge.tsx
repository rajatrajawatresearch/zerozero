import { Star } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { MoneyAmount } from '@/types';

/**
 * Small pill that surfaces a restaurant's aggregate rating.
 * Value arrives from the backend as a decimal string (`"4.32"`) — we parse
 * here and show one-decimal precision. Count is formatted with Intl locale.
 */
interface RatingBadgeProps {
  /** Backend ships `rating_avg` as a Decimal-string. */
  value: MoneyAmount | number;
  count: number;
  className?: string;
}

const COUNT_FORMATTER = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function RatingBadge({ value, count, className }: RatingBadgeProps) {
  const numeric = typeof value === 'number' ? value : Number(value);
  const safe = Number.isFinite(numeric) ? numeric : 0;

  // Map rating buckets to theme tokens — no hex literals per ZeroZero rule #8.
  const variant: 'success' | 'warning' | 'destructive' =
    safe >= 4 ? 'success' : safe >= 3 ? 'warning' : 'destructive';

  return (
    <Badge
      variant={variant}
      className={cn('gap-1 px-1.5 py-0.5 text-xs font-semibold', className)}
      aria-label={`Rated ${safe.toFixed(1)} out of 5 based on ${count} reviews`}
    >
      <Star className="size-3 fill-current" aria-hidden />
      <span>{safe.toFixed(1)}</span>
      {count > 0 ? (
        <span className="font-normal opacity-90">
          ({COUNT_FORMATTER.format(count)})
        </span>
      ) : null}
    </Badge>
  );
}

export default RatingBadge;

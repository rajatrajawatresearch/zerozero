/**
 * Read-only star rating display.
 *
 * Keeps the same visual vocabulary as the interactive `StarRatingInput` in
 * `features/orders/components/ReviewModal.tsx` — filled = `text-warning`,
 * empty = `text-muted-foreground`. Supports fractional values (e.g. 4.3) by
 * clipping the filled layer to the right percentage.
 *
 * The component is form-agnostic by design: if a slice later needs an
 * interactive variant for react-hook-form, it composes this for the visual
 * and adds button handlers. See the `ReviewModal` for the existing form flow.
 */
import { Star } from 'lucide-react';

import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*                                    Props                                   */
/* -------------------------------------------------------------------------- */
export interface StarRatingProps {
  /** Rating value in the 0..5 range. Clamped on render. */
  value: number;
  /** Max stars — defaults to 5. */
  max?: number;
  /** Tailwind size token for the icons — `size-4` (16px) by default. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Optional override. */
  className?: string;
  /** Include a "4.3" numeric label after the stars. */
  showValue?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<StarRatingProps['size']>, string> = {
  xs: 'size-3',
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
};

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function StarRating({
  value,
  max = 5,
  size = 'sm',
  className,
  showValue = false,
}: StarRatingProps): React.ReactElement {
  const safe = Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0;
  // Percentage of the filled overlay — drives the right-edge clip of the
  // coloured star layer for fractional ratings like 4.3.
  const filledPct = (safe / max) * 100;
  const iconClass = SIZE_CLASSES[size];

  return (
    <span
      className={cn('inline-flex items-center gap-1', className)}
      role="img"
      aria-label={`Rated ${safe.toFixed(1)} out of ${max}`}
    >
      <span className="relative inline-flex">
        {/* Empty layer — always rendered at full width. */}
        <span className="inline-flex gap-0.5 text-muted-foreground/40">
          {Array.from({ length: max }).map((_, i) => (
            <Star key={i} className={iconClass} aria-hidden />
          ))}
        </span>
        {/* Filled layer — clipped to `filledPct%` via width. */}
        <span
          className="pointer-events-none absolute inset-0 inline-flex gap-0.5 overflow-hidden text-warning"
          style={{ width: `${filledPct}%` }}
          aria-hidden
        >
          {Array.from({ length: max }).map((_, i) => (
            <Star
              key={i}
              className={cn(iconClass, 'shrink-0 fill-current')}
              aria-hidden
            />
          ))}
        </span>
      </span>
      {showValue ? (
        <span className="text-sm font-medium text-foreground">{safe.toFixed(1)}</span>
      ) : null}
    </span>
  );
}

export default StarRating;

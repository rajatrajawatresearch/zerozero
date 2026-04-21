import { Link } from 'react-router';
import { Clock, MapPin, Wallet } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { formatPrice } from '../hooks';
import type { RestaurantCard as RestaurantCardDto } from '../types';
import { CuisineChip } from './CuisineChip';
import { RatingBadge } from './RatingBadge';

/**
 * Restaurant tile used in the grid + search results. Entirely derived from
 * the `RestaurantCard` DTO from `GET /restaurants` so swapping in a real
 * server response needs zero UI changes.
 *
 * Interaction:
 *   - Whole card is a `<Link>` to `/r/{slug}` — cleaner than nested buttons
 *   - "Closed" overlay when `!is_open`
 *   - "Doesn't deliver here" pill when `!delivers_here` (only meaningful when
 *     lat/lng were supplied to the list query)
 */
interface RestaurantCardProps {
  restaurant: RestaurantCardDto;
  className?: string;
}

export function RestaurantCard({ restaurant: r, className }: RestaurantCardProps) {
  const undeliverable = r.delivers_here === false;
  const closed = !r.is_open;
  const unavailable = undeliverable || closed;

  return (
    <Link
      to={`/r/${r.slug}`}
      aria-label={`${r.name} — view menu`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card
        className={cn(
          'group gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md',
          unavailable && 'opacity-80',
          className,
        )}
      >
        {/* Cover image with overlay states */}
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          {r.cover_url ? (
            <img
              src={r.cover_url}
              alt=""
              loading="lazy"
              decoding="async"
              className={cn(
                'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]',
                closed && 'grayscale',
              )}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground text-sm">
              {r.name}
            </div>
          )}

          {closed ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
              <span className="rounded-md border border-border bg-background/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                Closed
              </span>
            </div>
          ) : null}

          {!closed && undeliverable ? (
            <div className="absolute left-2 top-2 rounded-md bg-destructive px-2 py-0.5 text-[11px] font-semibold text-destructive-foreground shadow-sm">
              Doesn&apos;t deliver here
            </div>
          ) : null}

          {r.rating_count > 0 ? (
            <div className="absolute right-2 top-2">
              <RatingBadge value={r.rating_avg} count={r.rating_count} />
            </div>
          ) : null}
        </div>

        <CardContent className="space-y-2 px-4 pb-4 pt-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-1 text-base font-semibold leading-snug text-foreground">
              {r.name}
            </h3>
          </div>

          {r.cuisines.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {r.cuisines.slice(0, 3).map((c) => (
                <CuisineChip key={c.id} name={c.name} icon={c.icon} />
              ))}
              {r.cuisines.length > 3 ? (
                <span className="text-[11px] text-muted-foreground">
                  +{r.cuisines.length - 3}
                </span>
              ) : null}
            </div>
          ) : null}

          <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden />
              <dt className="sr-only">Prep time</dt>
              <dd>{r.avg_prep_minutes} min</dd>
            </div>
            {r.distance_km !== null && r.distance_km !== undefined ? (
              <div className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                <dt className="sr-only">Distance</dt>
                <dd>{r.distance_km.toFixed(1)} km</dd>
              </div>
            ) : null}
            <div className="inline-flex items-center gap-1">
              <Wallet className="size-3.5" aria-hidden />
              <dt className="sr-only">Minimum order</dt>
              <dd>Min {formatPrice(r.min_order)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}

export default RestaurantCard;

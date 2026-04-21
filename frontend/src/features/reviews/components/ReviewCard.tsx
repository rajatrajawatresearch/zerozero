/**
 * Single review tile. Used inside `ReviewList` but exported via the slice
 * barrel so other surfaces (user profile "my reviews") can reuse the shell.
 *
 * Layout:
 *   [avatar]  [name + rating]     [time-ago]
 *             [comment text]
 *             [image grid (if any)]
 *
 * The image grid caps at 3 thumbnails + a "+N more" overlay on the 3rd tile
 * when there are more than 3 images — matches the Zomato convention.
 */
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useRelativeTime } from '@/features/orders/hooks';
import { cn } from '@/lib/utils';

import type { ReviewOut } from '../types';
import { StarRating } from './StarRating';

/* -------------------------------------------------------------------------- */
/*                                    Props                                   */
/* -------------------------------------------------------------------------- */
export interface ReviewCardProps {
  review: ReviewOut;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */
function userInitials(fullName: string | null | undefined): string {
  if (!fullName) return 'U';
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || 'U';
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function ReviewCard({ review, className }: ReviewCardProps): React.ReactElement {
  const timeLabel = useRelativeTime(review.created_at);
  const images = review.images ?? [];
  const visibleImages = images.slice(0, 3);
  const hiddenCount = Math.max(0, images.length - 3);

  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-card p-4',
        className,
      )}
      aria-label={`Review by ${review.user_name}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-10 shrink-0">
            {review.user_avatar_url ? (
              <AvatarImage src={review.user_avatar_url} alt="" />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-primary">
              {userInitials(review.user_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {review.user_name}
            </p>
            <StarRating value={review.rating} size="xs" />
          </div>
        </div>
        <time
          dateTime={review.created_at}
          className="shrink-0 text-xs text-muted-foreground"
          title={new Date(review.created_at).toLocaleString()}
        >
          {timeLabel}
        </time>
      </header>

      {review.comment ? (
        <p className="text-sm leading-relaxed text-foreground">{review.comment}</p>
      ) : null}

      {visibleImages.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {visibleImages.map((src, i) => {
            const isLastWithOverflow = i === visibleImages.length - 1 && hiddenCount > 0;
            return (
              <div
                key={src}
                className="relative aspect-square overflow-hidden rounded-md bg-muted"
              >
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                {isLastWithOverflow ? (
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm font-semibold text-foreground"
                    aria-label={`${hiddenCount} more images`}
                  >
                    +{hiddenCount} more
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

export default ReviewCard;

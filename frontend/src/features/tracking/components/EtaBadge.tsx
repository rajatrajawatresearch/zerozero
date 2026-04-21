/**
 * `EtaBadge` — displays minutes-remaining for an in-flight order.
 *
 * Thin wrapper around our shared `Badge` primitive so the styling stays
 * consistent with other badges in the app (radius, padding, focus ring).
 * Renders nothing when `minutes` is null — keeps layout tidy before the
 * first partner location arrives.
 */
import { Clock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface EtaBadgeProps {
  /** Minutes remaining (null = no data yet). */
  minutes: number | null;
  className?: string;
}

export function EtaBadge({
  minutes,
  className,
}: EtaBadgeProps): React.ReactElement | null {
  if (minutes === null || minutes < 0) return null;

  const label =
    minutes === 0 ? 'Arriving now' : `${minutes} min${minutes === 1 ? '' : 's'}`;

  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 border-border bg-background/90', className)}
    >
      <Clock className="size-3" aria-hidden />
      <span>{label}</span>
    </Badge>
  );
}

export default EtaBadge;

/**
 * Summary tile for the orders list. Mirrors the backend `OrderListItem`
 * shape exactly so swapping in a live response requires zero component
 * changes. Entire card is a link to the detail page.
 */
import { Link } from 'react-router';
import { MapPin } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatPrice } from '@/features/restaurants/hooks';
import { cn } from '@/lib/utils';

import { useRelativeTime } from '../hooks';
import type { OrderListItem, OrderStatus } from '../types';

/* -------------------------------------------------------------------------- */
/*                             Status → badge styling                         */
/* -------------------------------------------------------------------------- */
const STATUS_LABELS: Record<OrderStatus, string> = {
  placed: 'Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

const STATUS_VARIANTS: Record<
  OrderStatus,
  'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline'
> = {
  placed: 'secondary',
  confirmed: 'secondary',
  preparing: 'warning',
  ready: 'warning',
  out_for_delivery: 'default',
  delivered: 'success',
  cancelled: 'destructive',
  failed: 'destructive',
};

/* -------------------------------------------------------------------------- */
/*                                  Props                                     */
/* -------------------------------------------------------------------------- */
export interface OrderCardProps {
  order: OrderListItem;
  className?: string;
  /** Pass the item names for the 3-line summary; list endpoint only ships
   *  `item_count`, so parent can inject if already loaded elsewhere. */
  itemsPreview?: string;
}

/* -------------------------------------------------------------------------- */
/*                                Component                                   */
/* -------------------------------------------------------------------------- */
export function OrderCard({
  order,
  className,
  itemsPreview,
}: OrderCardProps): React.ReactElement {
  const placedLabel = useRelativeTime(order.placed_at);
  const preview =
    itemsPreview ?? `${order.item_count} item${order.item_count === 1 ? '' : 's'}`;

  return (
    <Link
      to={`/orders/${order.id}`}
      aria-label={`Order ${order.short_id} from ${order.restaurant_name}`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card
        className={cn(
          'group gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md',
          className,
        )}
      >
        <div className="flex gap-4 p-4">
          {/* Restaurant avatar */}
          <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-24">
            {order.restaurant_image ? (
              <img
                src={order.restaurant_image}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <MapPin className="size-6" aria-hidden />
              </div>
            )}
          </div>

          {/* Body */}
          <CardContent className="flex min-w-0 flex-1 flex-col gap-1 px-0 py-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-1 text-base font-semibold leading-snug text-foreground">
                {order.restaurant_name}
              </h3>
              <Badge variant={STATUS_VARIANTS[order.status]} className="shrink-0">
                {STATUS_LABELS[order.status]}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              #{order.short_id} &middot; {placedLabel}
            </p>

            <p className="line-clamp-3 text-sm text-muted-foreground">{preview}</p>

            <div className="mt-auto flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                {order.item_count} item{order.item_count === 1 ? '' : 's'}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatPrice(order.total)}
              </span>
            </div>
          </CardContent>
        </div>
      </Card>
    </Link>
  );
}

export default OrderCard;

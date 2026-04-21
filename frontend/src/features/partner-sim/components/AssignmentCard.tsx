/**
 * Compact brief of an order that's been assigned to the partner.
 *
 * Shows:
 *   - Restaurant name
 *   - Item count + first two item names
 *   - Drop address (label + line1 + pincode)
 *   - "Accept" button (POSTs to /partner/orders/{id}/accept)
 *
 * The accept button hides itself once the status has progressed past
 * `confirmed` (the backend returns a fresh detail on acceptance, so the
 * parent page simply re-renders with the new state).
 */
import { MapPin, Utensils, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import type { OrderDetailOut } from '@/features/orders/types';

import { useAcceptOrderMutation } from '../api';

/* -------------------------------------------------------------------------- */
/*                                   Props                                    */
/* -------------------------------------------------------------------------- */
export interface AssignmentCardProps {
  order: OrderDetailOut;
  /** Called after the accept mutation resolves so the parent can re-focus. */
  onAccepted?: (order: OrderDetailOut) => void;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function AssignmentCard({
  order,
  onAccepted,
  className,
}: AssignmentCardProps): React.ReactElement {
  const mutation = useAcceptOrderMutation();
  const itemPreview = order.items
    .slice(0, 2)
    .map((item) => `${item.qty}x ${item.name_snapshot}`)
    .join(' · ');
  const remaining = order.items.length - 2;
  const alreadyAccepted = order.status !== 'placed' && order.status !== 'confirmed';

  const handleAccept = (): void => {
    mutation.mutate(order.id, {
      onSuccess: (fresh) => {
        toast.success('Order accepted');
        onAccepted?.(fresh);
      },
      onError: (err) => {
        const msg = err instanceof ApiError ? err.detail : 'Could not accept order';
        toast.error(msg);
      },
    });
  };

  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              #{order.short_id}
            </p>
            <h3 className="line-clamp-1 text-base font-semibold text-foreground">
              {order.restaurant_name}
            </h3>
          </div>
          <Badge variant="outline" className="shrink-0">
            {order.status.replace(/_/g, ' ')}
          </Badge>
        </div>

        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <Utensils className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="line-clamp-2">
            {itemPreview || 'No items'}
            {remaining > 0 ? ` +${remaining} more` : ''}
          </span>
        </div>

        {order.address ? (
          <div className="flex items-start gap-2 text-sm text-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="line-clamp-2">
              <span className="font-medium">{order.address.label}</span>
              {' · '}
              {order.address.line1}
              {order.address.line2 ? `, ${order.address.line2}` : ''}, {order.address.city}{' '}
              {order.address.pincode}
            </span>
          </div>
        ) : null}

        <div className="pt-1">
          {alreadyAccepted ? (
            <Button type="button" variant="outline" disabled className="w-full">
              <CheckCircle2 className="size-4" aria-hidden />
              Accepted
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleAccept}
              disabled={mutation.isPending}
              className="w-full"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Accepting
                </>
              ) : (
                'Accept assignment'
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default AssignmentCard;

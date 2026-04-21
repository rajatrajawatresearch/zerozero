/**
 * Five-step status progression buttons: Confirmed → Preparing → Ready →
 * OutForDelivery → Delivered.
 *
 * Semantics:
 *   - Each button POSTs to `/partner/orders/{id}/status?s=X`.
 *   - A button is disabled when its step index is <= the current status
 *     index (i.e. the order has already reached or passed that state).
 *   - After a successful mutation the query cache is seeded by `api.ts`,
 *     which repaints the parent page — no local state needed here.
 *
 * Rendered as a horizontal pill strip on desktop, stacked on mobile.
 */
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  ORDER_PROGRESS_STEPS,
  type OrderStatus,
} from '@/features/orders/types';

import { useAdvanceStatusMutation } from '../api';
import { PARTNER_STATUS_STEPS, type PartnerStatusStep } from '../types';

/* -------------------------------------------------------------------------- */
/*                            Human-readable labels                           */
/* -------------------------------------------------------------------------- */
const LABELS: Record<PartnerStatusStep, string> = {
  confirmed: 'Confirm',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

/* -------------------------------------------------------------------------- */
/*                                   Props                                    */
/* -------------------------------------------------------------------------- */
export interface StatusButtonsProps {
  orderId: string;
  currentStatus: OrderStatus;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function StatusButtons({
  orderId,
  currentStatus,
  className,
}: StatusButtonsProps): React.ReactElement {
  const mutation = useAdvanceStatusMutation();
  // `ORDER_PROGRESS_STEPS` contains `placed` at index 0; we measure distance
  // along the same axis so "placed" < "confirmed" < … comparisons work out.
  // `cancelled` / `failed` are off-trail and resolve to -1, leaving every
  // button enabled so the partner can try to recover.
  const progressList: readonly OrderStatus[] = ORDER_PROGRESS_STEPS;
  const currentIndex = progressList.indexOf(currentStatus);

  const handleClick = (step: PartnerStatusStep): void => {
    mutation.mutate(
      { orderId, status: step },
      {
        onSuccess: (data) => {
          toast.success(`Status updated to ${data.status.replace(/_/g, ' ')}`);
        },
        onError: (err) => {
          const msg = err instanceof ApiError ? err.detail : 'Could not update status';
          toast.error(msg);
        },
      },
    );
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center',
        className,
      )}
      role="group"
      aria-label="Advance order status"
    >
      {PARTNER_STATUS_STEPS.map((step) => {
        const stepIndex = progressList.indexOf(step);
        const alreadyPast = currentIndex >= stepIndex;
        const isActive =
          mutation.isPending && mutation.variables?.status === step;

        return (
          <Button
            key={step}
            type="button"
            size="sm"
            variant={alreadyPast ? 'outline' : 'default'}
            disabled={alreadyPast || mutation.isPending}
            onClick={() => handleClick(step)}
            aria-pressed={alreadyPast}
          >
            {isActive ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {LABELS[step]}
          </Button>
        );
      })}
    </div>
  );
}

export default StatusButtons;

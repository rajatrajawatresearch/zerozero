/**
 * Horizontal 6-step progress indicator for an order lifecycle:
 *   placed → confirmed → preparing → ready → out_for_delivery → delivered
 *
 * - The step matching `status` has a pulsing dot (current).
 * - Completed steps show a filled dot + solid connector.
 * - Future steps are muted.
 * - When `status === 'cancelled'`, the steps are replaced by a single
 *   "Cancelled" label in destructive color (per Phase 3 contract).
 * - Mobile layout stacks the steps vertically.
 */
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

import { deriveOrderProgress } from '../hooks';
import type { OrderProgressStep, OrderStatus } from '../types';
import { ORDER_PROGRESS_STEPS } from '../types';

/* -------------------------------------------------------------------------- */
/*                                   Labels                                   */
/* -------------------------------------------------------------------------- */
const STEP_LABELS: Record<OrderProgressStep, string> = {
  placed: 'Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

/* -------------------------------------------------------------------------- */
/*                                  Props                                     */
/* -------------------------------------------------------------------------- */
export interface OrderStatusStepperProps {
  status: OrderStatus;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                                Component                                   */
/* -------------------------------------------------------------------------- */
export function OrderStatusStepper({
  status,
  className,
}: OrderStatusStepperProps): React.ReactElement {
  const progress = deriveOrderProgress(status);

  if (progress.isCancelled) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive',
          className,
        )}
        role="status"
        aria-label="Order cancelled"
      >
        <span className="inline-flex size-2.5 rounded-full bg-destructive" aria-hidden />
        <p className="text-sm font-semibold">Cancelled</p>
      </div>
    );
  }

  if (progress.isFailed) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive',
          className,
        )}
        role="status"
        aria-label="Order failed"
      >
        <span className="inline-flex size-2.5 rounded-full bg-destructive" aria-hidden />
        <p className="text-sm font-semibold">Failed</p>
      </div>
    );
  }

  return (
    <ol
      className={cn(
        'flex flex-col gap-4 md:flex-row md:items-start md:gap-0',
        className,
      )}
      aria-label="Order progress"
    >
      {ORDER_PROGRESS_STEPS.map((step, idx) => {
        const isCompleted = idx < progress.index;
        const isCurrent = idx === progress.index;
        const isLast = idx === ORDER_PROGRESS_STEPS.length - 1;
        const isConnectorActive = idx < progress.index;

        return (
          <li
            key={step}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-3 md:flex-col md:items-center md:gap-2 md:text-center',
            )}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <div className="flex items-center md:w-full md:flex-col">
              {/* Step marker */}
              <div className="relative flex items-center md:w-full md:justify-center">
                <span
                  className={cn(
                    'relative z-10 inline-flex size-6 items-center justify-center rounded-full border-2 transition-colors',
                    isCompleted && 'border-primary bg-primary text-primary-foreground',
                    isCurrent && 'border-primary bg-background text-primary',
                    !isCompleted && !isCurrent && 'border-border bg-background text-muted-foreground',
                  )}
                >
                  {isCompleted ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        isCurrent && 'bg-primary animate-pulse',
                        !isCurrent && 'bg-muted-foreground/40',
                      )}
                      aria-hidden
                    />
                  )}
                </span>

                {/* Connector to the next step (hidden on mobile) */}
                {!isLast ? (
                  <span
                    aria-hidden
                    className={cn(
                      'hidden h-0.5 flex-1 md:block',
                      isConnectorActive ? 'bg-primary' : 'bg-border',
                    )}
                  />
                ) : null}
              </div>
            </div>

            <span
              className={cn(
                'text-xs font-medium',
                isCurrent && 'text-foreground',
                isCompleted && 'text-foreground',
                !isCurrent && !isCompleted && 'text-muted-foreground',
              )}
            >
              {STEP_LABELS[step]}
            </span>

            {/* Mobile connector (vertical line from marker to next label) */}
            {!isLast ? (
              <span
                aria-hidden
                className={cn(
                  'ml-3 h-6 w-0.5 md:hidden',
                  isConnectorActive ? 'bg-primary' : 'bg-border',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default OrderStatusStepper;

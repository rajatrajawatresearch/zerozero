/**
 * 3-dot stepper used at the top of the CheckoutPage.
 *
 * Layout switches between horizontal (desktop / sm+) and a vertical-label
 * stack (mobile) so long step names don't overflow on narrow phones.
 * Each dot is a <button> so users can jump back to a completed step; the
 * parent gates forward jumps via `useCheckoutFlow.goTo`.
 */
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

import { CHECKOUT_STEPS, type CheckoutStep } from '../types';

const STEP_LABELS: Record<CheckoutStep, string> = {
  address: 'Address',
  payment: 'Payment',
  review: 'Review',
};

export interface StepIndicatorProps {
  current: CheckoutStep;
  onStepClick?: (step: CheckoutStep) => void;
}

export function StepIndicator({
  current,
  onStepClick,
}: StepIndicatorProps): React.ReactElement {
  const currentIdx = CHECKOUT_STEPS.indexOf(current);

  return (
    <ol
      aria-label="Checkout progress"
      className="flex w-full items-center gap-2 sm:gap-4"
    >
      {CHECKOUT_STEPS.map((step, idx) => {
        const state =
          idx < currentIdx
            ? 'complete'
            : idx === currentIdx
              ? 'active'
              : 'upcoming';
        const clickable = state === 'complete' || state === 'active';

        return (
          <li key={step} className="flex flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              disabled={!onStepClick || !clickable}
              onClick={() => onStepClick?.(step)}
              aria-current={state === 'active' ? 'step' : undefined}
              aria-label={`${STEP_LABELS[step]} step`}
              className={cn(
                'flex items-center gap-2 rounded-full text-left outline-offset-2',
                'focus-visible:outline-2 focus-visible:outline-primary',
                clickable
                  ? 'cursor-pointer'
                  : 'cursor-default opacity-80',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                  state === 'complete' &&
                    'bg-primary text-primary-foreground',
                  state === 'active' &&
                    'bg-primary/15 text-primary ring-2 ring-primary',
                  state === 'upcoming' &&
                    'bg-muted text-muted-foreground',
                )}
              >
                {state === 'complete' ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  idx + 1
                )}
              </span>
              <span
                className={cn(
                  'hidden text-sm font-medium sm:inline',
                  state === 'active'
                    ? 'text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {STEP_LABELS[step]}
              </span>
              {/* On mobile we show a compact label under the dot instead. */}
              <span
                className={cn(
                  'text-[11px] font-medium sm:hidden',
                  state === 'active'
                    ? 'text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {STEP_LABELS[step]}
              </span>
            </button>

            {idx < CHECKOUT_STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'h-px flex-1 transition-colors',
                  idx < currentIdx ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default StepIndicator;

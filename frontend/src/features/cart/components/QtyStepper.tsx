import { Minus, Plus } from 'lucide-react';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Shared +/- stepper used by `CartLineItem` and (future) checkout review.
 *
 * Decrementing below `min` triggers `onRemove` instead — mirrors the Zomato
 * pattern where tapping the minus at qty=1 removes the line rather than
 * silently no-op-ing.
 */
export interface QtyStepperProps {
  qty: number;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove?: () => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
}

export function QtyStepper({
  qty,
  onIncrement,
  onDecrement,
  onRemove,
  min = 1,
  max = 50,
  disabled = false,
  size = 'md',
  className,
  label = 'item',
}: QtyStepperProps): ReactElement {
  const handleDecrement = (): void => {
    if (qty <= min) {
      onRemove?.();
      return;
    }
    onDecrement();
  };

  const atMax = qty >= max;
  const dims =
    size === 'sm' ? 'h-7 w-20 text-xs' : 'h-8 w-24 text-sm sm:w-28';

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-md border border-primary bg-background text-primary shadow-sm',
        dims,
        disabled && 'opacity-60',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full w-8 text-primary hover:bg-primary/10"
        onClick={handleDecrement}
        disabled={disabled}
        aria-label={`Decrease ${label} quantity`}
      >
        <Minus className="size-3.5" />
      </Button>
      <span className="font-semibold tabular-nums" aria-live="polite">
        {qty}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full w-8 text-primary hover:bg-primary/10"
        onClick={onIncrement}
        disabled={disabled || atMax}
        aria-label={`Increase ${label} quantity`}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

export default QtyStepper;

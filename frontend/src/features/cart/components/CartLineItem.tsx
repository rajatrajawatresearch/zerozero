import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { formatPrice } from '@/features/restaurants/hooks';
import { cn } from '@/lib/utils';

import type { UiCartLine } from '../hooks';
import { QtyStepper } from './QtyStepper';

/**
 * Single cart row. Quantity changes are DEBOUNCED (200ms) so that mashing
 * the plus/minus buttons doesn't spam the API — only the final value is
 * flushed upstream. Remove is immediate.
 */
export interface CartLineItemProps {
  line: UiCartLine;
  onUpdateQty: (id: string, qty: number) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
  disabled?: boolean;
  className?: string;
}

const DEBOUNCE_MS = 200;

export function CartLineItem({
  line,
  onUpdateQty,
  onRemove,
  disabled,
  className,
}: CartLineItemProps): ReactElement {
  // Local optimistic qty — stays in sync with `line.qty` whenever the parent
  // refetches from the server, but responds instantly to button mashing.
  const [localQty, setLocalQty] = useState<number>(line.qty);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<number>(line.qty);

  useEffect(() => {
    // Server pushed a new qty (e.g. after the debounced flush resolved); adopt it.
    setLocalQty(line.qty);
    lastSentRef.current = line.qty;
  }, [line.qty]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const schedule = (nextQty: number): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (nextQty !== lastSentRef.current) {
        lastSentRef.current = nextQty;
        void onUpdateQty(line.id, nextQty);
      }
    }, DEBOUNCE_MS);
  };

  const handleInc = (): void => {
    const next = Math.min(localQty + 1, 50);
    setLocalQty(next);
    schedule(next);
  };

  const handleDec = (): void => {
    const next = Math.max(localQty - 1, 1);
    if (next === localQty) return;
    setLocalQty(next);
    schedule(next);
  };

  const handleRemove = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void onRemove(line.id);
  };

  const lineTotal = (Number(line.price) || 0) * localQty;
  const optionsLabel = summariseOptions(line.options);

  return (
    <li
      className={cn(
        'flex items-start gap-3 border-b border-border py-3 last:border-b-0',
        className,
      )}
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
        {line.imageUrl ? (
          <img
            src={line.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
            No image
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <p className="line-clamp-1 text-sm font-medium text-foreground">
          {line.name}
        </p>
        {optionsLabel ? (
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {optionsLabel}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {formatPrice(line.price)} each
        </p>
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-semibold text-foreground tabular-nums">
          {formatPrice(lineTotal.toFixed(2))}
        </span>
        <QtyStepper
          qty={localQty}
          onIncrement={handleInc}
          onDecrement={handleDec}
          onRemove={handleRemove}
          disabled={disabled ?? false}
          size="sm"
          label={line.name}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1 text-xs text-muted-foreground hover:text-destructive"
          onClick={handleRemove}
          disabled={disabled ?? false}
          aria-label={`Remove ${line.name} from cart`}
        >
          <Trash2 className="size-3" aria-hidden />
          Remove
        </Button>
      </div>
    </li>
  );
}

/** Render `{ size: "large", spicy: true }` → `"size: large · spicy"`. */
function summariseOptions(options: Record<string, unknown>): string {
  const entries = Object.entries(options);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      if (typeof v === 'boolean') return v ? k : '';
      return `${k}: ${String(v)}`;
    })
    .filter(Boolean)
    .join(' · ');
}

export default CartLineItem;

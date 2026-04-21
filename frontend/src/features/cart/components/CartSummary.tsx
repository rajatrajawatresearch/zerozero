import type { ReactElement } from 'react';

import { Separator } from '@/components/ui/separator';
import { formatPrice } from '@/features/restaurants/hooks';
import { cn } from '@/lib/utils';

/**
 * Shared bill summary (subtotal → delivery → tax → total). Used by both
 * `CartDrawer` and `CartPage`. All values are CLIENT-SIDE ESTIMATES — the
 * authoritative total is computed server-side at checkout (`POST /orders`).
 */
export interface CartSummaryProps {
  subtotal: number;
  /** Optional overrides — callers (checkout) may swap these once a real
   * quote comes back from the backend. */
  deliveryFee?: number;
  tax?: number;
  discount?: number;
  className?: string;
  compact?: boolean;
}

// Placeholder rates mirroring backend contract (`docs/PHASE3_CONTRACTS.md`).
const DEFAULT_DELIVERY_FEE = 30;
const TAX_RATE = 0.05;

export function CartSummary({
  subtotal,
  deliveryFee = DEFAULT_DELIVERY_FEE,
  tax,
  discount = 0,
  className,
  compact = false,
}: CartSummaryProps): ReactElement {
  const estimatedTax = tax ?? round2(subtotal * TAX_RATE);
  const total = Math.max(0, subtotal + deliveryFee + estimatedTax - discount);

  return (
    <dl
      className={cn(
        'space-y-2 text-sm',
        compact ? 'text-xs' : 'text-sm',
        className,
      )}
      aria-label="Order summary"
    >
      <Row label="Subtotal" value={formatPrice(subtotal.toFixed(2))} />
      {discount > 0 ? (
        <Row
          label="Discount"
          value={`- ${formatPrice(discount.toFixed(2))}`}
          tone="success"
        />
      ) : null}
      <Row
        label="Delivery fee"
        value={formatPrice(deliveryFee.toFixed(2))}
        muted
      />
      <Row
        label="Tax (est.)"
        value={formatPrice(estimatedTax.toFixed(2))}
        muted
      />

      <Separator className="my-2" />

      <div className="flex items-baseline justify-between">
        <dt className="text-base font-semibold text-foreground">Total</dt>
        <dd className="text-base font-semibold tabular-nums text-foreground">
          {formatPrice(total.toFixed(2))}
        </dd>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Final taxes &amp; fees confirmed at checkout.
      </p>
    </dl>
  );
}

function Row({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  tone?: 'success';
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className={cn('text-muted-foreground', muted && 'text-muted-foreground')}>
        {label}
      </dt>
      <dd
        className={cn(
          'tabular-nums',
          tone === 'success' ? 'text-success' : 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default CartSummary;

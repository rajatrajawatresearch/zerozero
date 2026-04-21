/**
 * Price-breakdown card shown on `OrderDetailPage`.
 *
 * Renders: subtotal, discount, delivery fee, tax, total. Discount appears
 * in the success (green) color when > 0, so the customer sees savings at a
 * glance — muted otherwise.
 */
import { Separator } from '@/components/ui/separator';
import { formatPrice } from '@/features/restaurants/hooks';
import type { MoneyAmount } from '@/types';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*                                  Props                                     */
/* -------------------------------------------------------------------------- */
export interface OrderSummaryBoxProps {
  subtotal: MoneyAmount;
  discount: MoneyAmount;
  delivery_fee: MoneyAmount;
  tax: MoneyAmount;
  total: MoneyAmount;
  className?: string;
  /** Show the optional promo-code label alongside the discount line. */
  promoCode?: string | null;
}

/* -------------------------------------------------------------------------- */
/*                                 Helpers                                    */
/* -------------------------------------------------------------------------- */
function isPositive(value: MoneyAmount): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function OrderSummaryBox({
  subtotal,
  discount,
  delivery_fee,
  tax,
  total,
  className,
  promoCode,
}: OrderSummaryBoxProps): React.ReactElement {
  const discountActive = isPositive(discount);

  return (
    <section
      aria-label="Payment summary"
      className={cn(
        'rounded-lg border border-border bg-card p-5',
        className,
      )}
    >
      <h2 className="mb-3 text-sm font-semibold text-foreground">Payment summary</h2>

      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="font-medium text-foreground">{formatPrice(subtotal)}</dd>
        </div>

        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">
            Discount{promoCode && discountActive ? (
              <span className="ml-1 text-xs font-semibold uppercase tracking-wide text-success">
                ({promoCode})
              </span>
            ) : null}
          </dt>
          <dd
            className={cn(
              'font-medium',
              discountActive ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {discountActive ? `-${formatPrice(discount)}` : formatPrice('0')}
          </dd>
        </div>

        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Delivery fee</dt>
          <dd className="font-medium text-foreground">{formatPrice(delivery_fee)}</dd>
        </div>

        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Tax</dt>
          <dd className="font-medium text-foreground">{formatPrice(tax)}</dd>
        </div>
      </dl>

      <Separator className="my-4" />

      <div className="flex items-center justify-between text-base font-semibold">
        <span>Total</span>
        <span>{formatPrice(total)}</span>
      </div>
    </section>
  );
}

export default OrderSummaryBox;

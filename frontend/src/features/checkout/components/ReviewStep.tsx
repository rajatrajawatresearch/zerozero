/**
 * Step 3 — final review before placing the order.
 *
 * Renders an itemised breakdown pulled from the guest `useCartStore`
 * (which Agent 7 mirrors to the server cart — either way, lines live in
 * that store). We compute a **ballpark** total client-side so the user
 * sees delivery fee + tax + discount before hitting "Place Order" — the
 * authoritative numbers come back from the server on POST /orders.
 *
 * Delivery-fee / tax formulas mirror the backend service math (see
 * PHASE3_CONTRACTS.md > Orders > Service responsibilities):
 *   - delivery_fee ≈ ₹40 flat (distance detail lives server-side)
 *   - tax          = subtotal * 0.05
 *
 * Promo code, if applied, reduces the grand total; `free_delivery`
 * additionally zeros the delivery line.
 */
import { useMemo } from 'react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAddressesQuery } from '@/features/location';
import { useCartStore, selectCartTotal } from '@/store/cart';
import type { PaymentMethod } from '@/types';

import type { AppliedPromo } from '../types';

/** Mirror of backend's placeholder delivery-fee base. */
const DELIVERY_FEE_ESTIMATE = 40;
const TAX_RATE = 0.05;

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  upi: 'UPI',
  card: 'Credit / Debit card',
  wallet: 'Wallet',
  cod: 'Cash on delivery',
};

export interface ReviewStepProps {
  addressId: string | null;
  paymentMethod: PaymentMethod | null;
  appliedPromo: AppliedPromo | null;
  notes: string;
  onNotesChange: (n: string) => void;
}

export function ReviewStep({
  addressId,
  paymentMethod,
  appliedPromo,
  notes,
  onNotesChange,
}: ReviewStepProps): React.ReactElement {
  const lines = useCartStore((s) => s.lines);
  const subtotal = useCartStore(selectCartTotal);
  const { data: addresses } = useAddressesQuery();

  const address = addresses?.find((a) => a.id === addressId) ?? null;

  const { deliveryFee, tax, discount, total } = useMemo(() => {
    const discountAmt = appliedPromo
      ? Math.min(parseFloat(appliedPromo.discount), subtotal)
      : 0;
    const delivery = appliedPromo?.free_delivery ? 0 : DELIVERY_FEE_ESTIMATE;
    const taxAmt = Math.round(subtotal * TAX_RATE * 100) / 100;
    const totalAmt = Math.max(0, subtotal - discountAmt + delivery + taxAmt);
    return {
      deliveryFee: delivery,
      tax: taxAmt,
      discount: discountAmt,
      total: totalAmt,
    };
  }, [subtotal, appliedPromo]);

  return (
    <div className="space-y-4">
      {/* ----- Cart summary ----- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Your cart is empty.
            </p>
          ) : (
            <ul className="space-y-2">
              {lines.map((l) => {
                const lineTotal = parseFloat(l.price) * l.qty;
                return (
                  <li
                    key={l.clientId}
                    className="flex items-start justify-between gap-3 text-sm"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">
                        ₹{parseFloat(l.price).toFixed(2)} × {l.qty}
                      </p>
                    </div>
                    <p className="font-semibold tabular-nums">
                      ₹{lineTotal.toFixed(2)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ----- Delivery to ----- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deliver to</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {address ? (
            <>
              <p className="font-semibold">{address.label}</p>
              <address className="mt-0.5 not-italic leading-relaxed text-muted-foreground">
                {address.line1}
                {address.line2 ? <>, {address.line2}</> : null}
                <br />
                {address.city}, {address.state} — {address.pincode}
              </address>
            </>
          ) : (
            <p className="text-muted-foreground">
              No address selected — go back to step 1.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ----- Payment method ----- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="font-medium">
            {paymentMethod
              ? PAYMENT_LABELS[paymentMethod]
              : 'No payment method selected'}
          </p>
        </CardContent>
      </Card>

      {/* ----- Notes ----- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery note (optional)</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="e.g. Leave at the door, call on arrival…"
            maxLength={280}
            rows={2}
            className="min-h-16 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-offset-2 placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary"
          />
        </CardContent>
      </Card>

      {/* ----- Bill summary ----- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bill details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Item total" value={subtotal} />
          {appliedPromo && discount > 0 && (
            <Row
              label={`Promo (${appliedPromo.code})`}
              value={-discount}
              accent
            />
          )}
          <Row
            label={
              appliedPromo?.free_delivery
                ? 'Delivery fee (free)'
                : 'Delivery fee (est.)'
            }
            value={deliveryFee}
            strikethroughFrom={
              appliedPromo?.free_delivery ? DELIVERY_FEE_ESTIMATE : undefined
            }
          />
          <Row label="Taxes (GST 5%)" value={tax} />
          <Separator className="my-2" />
          <Row label="Total to pay" value={total} bold />
          <p className="text-[11px] text-muted-foreground">
            Final charge calculated on the server at payment time.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Inline presentational                           */
/* -------------------------------------------------------------------------- */
interface RowProps {
  label: string;
  value: number;
  accent?: boolean;
  bold?: boolean;
  /** When set, shows this amount struck through to the left of the value. */
  strikethroughFrom?: number | undefined;
}

function Row({
  label,
  value,
  accent,
  bold,
  strikethroughFrom,
}: RowProps): React.ReactElement {
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  return (
    <div
      className={`flex items-center justify-between ${
        bold ? 'text-base font-semibold' : ''
      }`}
    >
      <span className={accent ? 'text-primary' : 'text-muted-foreground'}>
        {label}
      </span>
      <span
        className={`tabular-nums ${accent ? 'text-primary' : ''} ${
          bold ? 'text-foreground' : ''
        }`}
      >
        {strikethroughFrom !== undefined && (
          <span className="mr-1 text-xs text-muted-foreground line-through">
            ₹{strikethroughFrom.toFixed(2)}
          </span>
        )}
        {sign}₹{abs.toFixed(2)}
      </span>
    </div>
  );
}

export default ReviewStep;

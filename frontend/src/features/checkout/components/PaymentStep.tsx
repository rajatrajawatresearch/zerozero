/**
 * Step 2 — choose a payment method.
 *
 * All four methods (UPI / Card / Wallet / COD) route through the same
 * backend mock-charge endpoint (see Agent 4's contract), so this step is
 * purely a radio-group of labels + icons with no per-method form. When
 * the real gateway lands in a later phase, this is where the flip
 * to `<Card/>` fields will happen.
 */
import {
  Banknote,
  CreditCard,
  Smartphone,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { PaymentMethod } from '@/types';

interface MethodDef {
  value: PaymentMethod;
  label: string;
  description: string;
  icon: LucideIcon;
}

const METHODS: readonly MethodDef[] = [
  {
    value: 'upi',
    label: 'UPI',
    description: 'Pay via any UPI app',
    icon: Smartphone,
  },
  {
    value: 'card',
    label: 'Credit / Debit card',
    description: 'Visa, Mastercard, Rupay',
    icon: CreditCard,
  },
  {
    value: 'wallet',
    label: 'Wallet',
    description: 'Paytm, PhonePe, etc.',
    icon: Wallet,
  },
  {
    value: 'cod',
    label: 'Cash on delivery',
    description: 'Pay when your order arrives',
    icon: Banknote,
  },
];

export interface PaymentStepProps {
  selected: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
}

export function PaymentStep({
  selected,
  onSelect,
}: PaymentStepProps): React.ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label="Payment method"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {METHODS.map(({ value, label, description, icon: Icon }) => {
        const checked = selected === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onSelect(value)}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
              'hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-primary',
              checked
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-4 flex-shrink-0 items-center justify-center rounded-full border-2',
                checked ? 'border-primary' : 'border-muted-foreground',
              )}
            >
              {checked && <span className="size-2 rounded-full bg-primary" />}
            </span>
            <Icon
              className={cn(
                'size-5 flex-shrink-0',
                checked ? 'text-primary' : 'text-muted-foreground',
              )}
              aria-hidden
            />
            <div className="flex-1">
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default PaymentStep;

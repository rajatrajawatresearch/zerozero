/**
 * Promo code input with inline Apply / Remove action.
 *
 * Hits `POST /promos/validate` on Apply — we do NOT debounce here because:
 *   - Keystroke-triggered validation would hammer the backend while the
 *     user is mid-typing the code.
 *   - Promo codes are opaque strings; there's no preview value from
 *     partial input.
 *
 * On a valid code, we lift the result up to the parent (`useCheckoutFlow`)
 * which stores it and uses it on the final place-order call. The server
 * re-validates at checkout time — we never trust the client-side discount
 * for the final charge.
 */
import { useState } from 'react';
import { Check, Loader2, Tag, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { MoneyAmount } from '@/types';

import { usePromoValidateMutation } from '../api';
import type { AppliedPromo } from '../types';

export interface PromoInputProps {
  subtotal: MoneyAmount;
  applied: AppliedPromo | null;
  onApply: (promo: AppliedPromo) => void;
  onRemove: () => void;
}

export function PromoInput({
  subtotal,
  applied,
  onApply,
  onRemove,
}: PromoInputProps): React.ReactElement {
  const [code, setCode] = useState('');
  const mutation = usePromoValidateMutation();

  const handleApply = async (): Promise<void> => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    try {
      const result = await mutation.mutateAsync({
        code: trimmed,
        subtotal,
      });
      if (!result.valid) {
        const reason =
          result.reason === 'expired'
            ? 'This promo has expired.'
            : result.reason === 'min_order'
              ? 'Order total is below the minimum for this promo.'
              : result.reason === 'usage_exceeded'
                ? 'You have already used this promo.'
                : 'This promo is not valid.';
        toast.error(reason);
        return;
      }
      onApply({
        code: result.code,
        discount: result.discount,
        free_delivery: result.free_delivery,
      });
      setCode('');
      toast.success(
        result.free_delivery
          ? `Free delivery + discount applied`
          : `Discount applied`,
      );
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.detail : 'Could not validate promo.';
      toast.error(detail);
    }
  };

  if (applied) {
    const discountNum = parseFloat(applied.discount);
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3',
        )}
      >
        <div className="flex items-center gap-2">
          <Check className="size-4 text-primary" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {applied.code}
            </p>
            <p className="text-xs text-muted-foreground">
              −₹{discountNum.toFixed(2)} discount applied
              {applied.free_delivery ? ' · free delivery' : ''}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label="Remove promo code"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Tag
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Promo code"
          className="pl-9 uppercase"
          aria-label="Promo code"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleApply();
            }
          }}
        />
      </div>
      <Button
        type="button"
        onClick={() => void handleApply()}
        disabled={!code.trim() || mutation.isPending}
      >
        {mutation.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          'Apply'
        )}
      </Button>
    </div>
  );
}

export default PromoInput;

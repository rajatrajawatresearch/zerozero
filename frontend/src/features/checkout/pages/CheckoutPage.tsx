/**
 * /checkout — the 3-step place-order funnel.
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │ Header: back link + "Checkout"       │
 *   │ StepIndicator                        │
 *   ├──────────────────────────────────────┤
 *   │ Step content (grid, 2/3 : 1/3 on md) │
 *   │  - left  : AddressStep | Payment | … │
 *   │  - right : sticky PromoInput + mini  │
 *   │            bill summary              │
 *   ├──────────────────────────────────────┤
 *   │ Sticky bottom Continue / Place Order │
 *   └──────────────────────────────────────┘
 *
 * Guards:
 *   - ProtectedRoute wraps this file (applied in routes.tsx).
 *   - If the cart is empty we redirect back to `/` before rendering any UI.
 *
 * Final submit wires `useCheckoutMutation` → on success `navigate(
 *   /orders/${order.id}?new=1, { replace: true })` so the browser back
 * button skips the checkout page (which no longer makes sense post-order).
 *
 * The `?new=1` hint is consumed by Agent 9's `OrderDetailPage` to fire the
 * confetti toast on first render.
 */
import { useEffect } from 'react';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { ProtectedRoute } from '@/features/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useCartStore, selectCartTotal } from '@/store/cart';

import { useCheckoutMutation } from '../api';
import { useCheckoutFlow } from '../hooks';
import { AddressStep } from '../components/AddressStep';
import { PaymentStep } from '../components/PaymentStep';
import { PromoInput } from '../components/PromoInput';
import { ReviewStep } from '../components/ReviewStep';
import { StepIndicator } from '../components/StepIndicator';

function CheckoutPageInner(): React.ReactElement {
  const navigate = useNavigate();
  const flow = useCheckoutFlow();
  const mutation = useCheckoutMutation();

  const lines = useCartStore((s) => s.lines);
  const subtotal = useCartStore(selectCartTotal);

  /* -------------------- Guard: empty cart → bounce back ------------------- */
  useEffect(() => {
    if (lines.length === 0) {
      void navigate('/', { replace: true });
    }
  }, [lines.length, navigate]);

  /* ----------------- Reset the flow store on unmount ---------------------- */
  useEffect(() => () => flow.reset(), [flow.reset]);

  const handlePlaceOrder = async (): Promise<void> => {
    if (!flow.addressId || !flow.paymentMethod) return;
    try {
      const order = await mutation.mutateAsync({
        address_id: flow.addressId,
        payment_method: flow.paymentMethod,
        promo_code: flow.appliedPromo?.code ?? null,
        notes: flow.notes.trim() || null,
      });
      // Clear the local guest cart; the server cart is wiped by the backend
      // inside the same tx so the TanStack invalidate in the mutation's
      // `onSuccess` will drop the server view on the next render.
      useCartStore.getState().clear();
      flow.reset();
      toast.success('Order placed!');
      void navigate(`/orders/${order.id}?new=1`, { replace: true });
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.detail : 'Could not place your order.';
      toast.error(detail);
    }
  };

  const handleContinue = (): void => {
    if (!flow.canAdvance) return;
    if (flow.isFinalStep) {
      void handlePlaceOrder();
    } else {
      flow.goNext();
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:px-8">
      {/* ------------------------------ Header ------------------------------ */}
      <div className="mb-6 flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => (flow.stepIndex === 0 ? navigate(-1) : flow.goBack())}
          aria-label="Go back"
          className="gap-1"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {flow.stepIndex === 0 ? 'Back' : 'Previous'}
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
      </div>

      <div className="mb-6">
        <StepIndicator current={flow.step} onStepClick={flow.goTo} />
      </div>

      {/* ------------------------------ Body -------------------------------- */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {flow.step === 'address' && (
            <AddressStep
              selectedId={flow.addressId}
              onSelect={flow.setAddressId}
            />
          )}
          {flow.step === 'payment' && (
            <PaymentStep
              selected={flow.paymentMethod}
              onSelect={flow.setPaymentMethod}
            />
          )}
          {flow.step === 'review' && (
            <ReviewStep
              addressId={flow.addressId}
              paymentMethod={flow.paymentMethod}
              appliedPromo={flow.appliedPromo}
              notes={flow.notes}
              onNotesChange={flow.setNotes}
            />
          )}
        </div>

        {/* Sidebar — promo + mini summary (hidden while primary panel uses it) */}
        <aside className="space-y-4 md:sticky md:top-24 md:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Have a promo code?</CardTitle>
            </CardHeader>
            <CardContent>
              <PromoInput
                subtotal={subtotal.toFixed(2)}
                applied={flow.appliedPromo}
                onApply={flow.setAppliedPromo}
                onRemove={() => flow.setAppliedPromo(null)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-6 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums font-medium">
                  ₹{subtotal.toFixed(2)}
                </span>
              </div>
              {flow.appliedPromo && (
                <div className="flex items-center justify-between text-primary">
                  <span>Promo</span>
                  <span className="tabular-nums">
                    −₹{parseFloat(flow.appliedPromo.discount).toFixed(2)}
                  </span>
                </div>
              )}
              <p className="pt-1 text-[11px] text-muted-foreground">
                Delivery &amp; taxes calculated at final review.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* ------------------------ Sticky bottom CTA ------------------------- */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="hidden flex-col sm:flex">
            <span className="text-xs text-muted-foreground">Subtotal</span>
            <span className="text-base font-semibold tabular-nums">
              ₹{subtotal.toFixed(2)}
            </span>
          </div>
          <Button
            type="button"
            size="lg"
            className="ml-auto gap-2"
            disabled={
              !flow.canAdvance || mutation.isPending || lines.length === 0
            }
            onClick={handleContinue}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Placing order…
              </>
            ) : flow.isFinalStep ? (
              <>
                <CheckCircle2 className="size-4" aria-hidden />
                Place order
              </>
            ) : (
              'Continue'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Default export is the auth-wrapped page so `routes.tsx` can lazy-load
 * it without needing an extra wrapper component.
 */
export default function CheckoutPage(): React.ReactElement {
  return (
    <ProtectedRoute>
      <CheckoutPageInner />
    </ProtectedRoute>
  );
}

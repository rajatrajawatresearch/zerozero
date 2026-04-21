/**
 * /checkout/success — thin alias that bounces into the Orders slice.
 *
 * The actual post-checkout celebration (confetti, order summary, live
 * status stepper) lives in Agent 9's `OrderDetailPage` at
 * `/orders/:id?new=1`. We keep this file so anyone who bookmarks or
 * deep-links `/checkout/success?order=<id>` still lands somewhere sane.
 *
 * Not registered in routes.tsx by default — Agent 10 can opt-in if a
 * design surface ever needs a distinct success URL. No-op otherwise.
 */
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router';

export default function CheckoutSuccessPage(): React.ReactElement {
  const [params] = useSearchParams();
  const orderId = params.get('order');

  // Keep a short effect so the component participates in tests that wait
  // for mount side-effects. No-op otherwise.
  useEffect(() => {
    /* noop — all work is done via <Navigate /> below. */
  }, []);

  if (!orderId) {
    return <Navigate to="/orders" replace />;
  }

  return (
    <>
      <Navigate to={`/orders/${orderId}?new=1`} replace />
      <div
        role="status"
        className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground"
      >
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        <span className="text-sm">Loading your order…</span>
      </div>
    </>
  );
}

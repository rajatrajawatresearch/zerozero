/**
 * Public surface of the Checkout feature.
 *
 * Agent 10 (FE-Layout) imports `checkoutRoutes` here and merges it into
 * the root router. Other features (cart drawer's "Go to checkout" button,
 * for instance) may import `useCheckoutFlow` if they need to preview or
 * mutate the in-flight checkout state — but in practice, the flow is
 * self-contained on `/checkout` and consumers should just `navigate` to
 * the URL.
 *
 * Pages are intentionally not re-exported — they are code-split via
 * `routes.tsx` and should not land in the main bundle.
 */

/* -------------------------------------------------------------------------- */
/*                                 Routes                                     */
/* -------------------------------------------------------------------------- */
export { checkoutRoutes } from './routes';

/* -------------------------------------------------------------------------- */
/*                                 API hooks                                  */
/* -------------------------------------------------------------------------- */
export {
  useCheckoutMutation,
  usePromoValidateMutation,
} from './api';

/* -------------------------------------------------------------------------- */
/*                                   Hooks                                    */
/* -------------------------------------------------------------------------- */
export { useCheckoutFlow } from './hooks';
export type { UseCheckoutFlowValue } from './hooks';

/* -------------------------------------------------------------------------- */
/*                               Components                                   */
/* -------------------------------------------------------------------------- */
export { StepIndicator } from './components/StepIndicator';
export { AddressStep } from './components/AddressStep';
export { PaymentStep } from './components/PaymentStep';
export { ReviewStep } from './components/ReviewStep';
export { PromoInput } from './components/PromoInput';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */
export type {
  CheckoutIn,
  OrderDetailOut,
  OrderItemOut,
  OrderStatusEventOut,
  PromoValidateIn,
  PromoValidateOut,
  CheckoutStep,
  AppliedPromo,
} from './types';
export { CHECKOUT_STEPS } from './types';

/**
 * TanStack Query mutations for the Checkout flow.
 *
 * Two endpoints are wrapped here:
 *   1. POST /orders            — atomic cart → order conversion (backend
 *                                snapshots prices, clears the cart in the
 *                                same tx, emits initial status event).
 *   2. POST /promos/validate   — live discount preview for `PromoInput`.
 *
 * Side effects on success:
 *   - `QK.cart.current`     — invalidated so the cart drawer empties
 *   - `QK.orders.all`       — invalidated so /orders list refreshes
 *
 * Agent 9 (FE-Orders) will also seed the `orders.detail(id)` cache off the
 * response so the redirect to `/orders/:id?new=1` renders immediately
 * without waiting on another round-trip.
 */
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api';
import { QK } from '@/lib/constants';

import type {
  CheckoutIn,
  OrderDetailOut,
  PromoValidateIn,
  PromoValidateOut,
} from './types';

/* -------------------------------------------------------------------------- */
/*                                 Endpoints                                  */
/* -------------------------------------------------------------------------- */
const PATHS = {
  CHECKOUT: '/orders',
  PROMO_VALIDATE: '/promos/validate',
} as const;

/* -------------------------------------------------------------------------- */
/*                              useCheckoutMutation                            */
/* -------------------------------------------------------------------------- */
/**
 * POST /orders — converts the logged-in user's cart into an order.
 *
 * On success we seed the order-detail cache and invalidate the cart + the
 * orders list. The caller (`CheckoutPage`) then navigates to
 * `/orders/:id?new=1` which Agent 9's page reads to trigger a confetti
 * toast on first render.
 */
export function useCheckoutMutation(): UseMutationResult<
  OrderDetailOut,
  Error,
  CheckoutIn
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CheckoutIn) =>
      api.post<OrderDetailOut>(
        PATHS.CHECKOUT,
        body as unknown as Record<string, unknown>,
      ),
    onSuccess: (order) => {
      // Seed the order-detail cache so the post-checkout redirect does not
      // flash a spinner before Agent 9's page fetches the same row again.
      qc.setQueryData(QK.orders.detail(order.id), order);
      void qc.invalidateQueries({ queryKey: QK.cart.current });
      void qc.invalidateQueries({ queryKey: QK.orders.all });
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                           usePromoValidateMutation                          */
/* -------------------------------------------------------------------------- */
/**
 * POST /promos/validate — stateless probe; no cache side-effects.
 *
 * The UI keeps the last-applied `PromoValidateOut` in local state (via
 * `useCheckoutFlow`) because it needs to be referenced on both the review
 * step and, eventually, the place-order call.
 */
export function usePromoValidateMutation(): UseMutationResult<
  PromoValidateOut,
  Error,
  PromoValidateIn
> {
  return useMutation({
    mutationFn: (body: PromoValidateIn) =>
      api.post<PromoValidateOut>(
        PATHS.PROMO_VALIDATE,
        body as unknown as Record<string, unknown>,
      ),
  });
}

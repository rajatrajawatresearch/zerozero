/**
 * TanStack Query hooks for the server cart (`/cart` endpoints).
 *
 * Routes (contract — `docs/PHASE3_CONTRACTS.md`, Cart section):
 *   GET    /cart                → CartOut
 *   POST   /cart/items          → 201 CartItemOut
 *   PATCH  /cart/items/{id}     → CartItemOut
 *   DELETE /cart/items/{id}     → 204
 *   DELETE /cart                → 204  (clear cart)
 *
 * Every mutation invalidates `['cart']` so the drawer/page re-renders
 * with the fresh server truth. Guest-cart (Zustand) handling lives in
 * `hooks.ts` — this file only speaks to the API.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api';
import { QK } from '@/lib/constants';
import { useAuthStore } from '@/store/auth';

import type {
  CartItemIn,
  CartItemOut,
  CartItemPatchIn,
  CartOut,
} from './types';

/* -------------------------------------------------------------------------- */
/*                                 Query keys                                 */
/* -------------------------------------------------------------------------- */
/** Canonical cart query keys — import from the barrel instead of `QK.cart`. */
export const cartKeys = {
  current: QK.cart.current,
} as const;

/* -------------------------------------------------------------------------- */
/*                                    Query                                    */
/* -------------------------------------------------------------------------- */
/**
 * GET /cart — only fires when an access token is present. Guest users rely
 * on `useCartStore` (Zustand) and never hit this endpoint.
 */
export function useCartQuery(): UseQueryResult<CartOut, Error> {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery<CartOut, Error>({
    queryKey: cartKeys.current,
    queryFn: () => api.get<CartOut>('/cart'),
    enabled: !!accessToken,
    staleTime: 10_000,
  });
}

/* -------------------------------------------------------------------------- */
/*                                 Mutations                                   */
/* -------------------------------------------------------------------------- */
/** POST /cart/items — add or increment a line. */
export function useAddToCartMutation(): UseMutationResult<
  CartItemOut,
  Error,
  CartItemIn
> {
  const queryClient = useQueryClient();
  return useMutation<CartItemOut, Error, CartItemIn>({
    mutationFn: (body) =>
      api.post<CartItemOut>(
        '/cart/items',
        body as unknown as Record<string, unknown>,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cartKeys.current });
    },
  });
}

/** PATCH /cart/items/{id} — update quantity on an existing line. */
export function useUpdateCartItemMutation(): UseMutationResult<
  CartItemOut,
  Error,
  { id: string; patch: CartItemPatchIn }
> {
  const queryClient = useQueryClient();
  return useMutation<
    CartItemOut,
    Error,
    { id: string; patch: CartItemPatchIn }
  >({
    mutationFn: ({ id, patch }) =>
      api.patch<CartItemOut>(
        `/cart/items/${id}`,
        patch as unknown as Record<string, unknown>,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cartKeys.current });
    },
  });
}

/** DELETE /cart/items/{id} — remove a single line. */
export function useRemoveFromCartMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/cart/items/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cartKeys.current });
    },
  });
}

/** DELETE /cart — wipe every line (used on "Clear cart" or post-checkout). */
export function useClearCartMutation(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => api.delete<void>('/cart'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cartKeys.current });
    },
  });
}

/**
 * TanStack Query hooks for the Orders slice.
 *
 * Endpoints (prefix `/api/v1` baked into `api.baseUrl`):
 *   GET  /orders                 -> PageOut<OrderListItem>
 *   GET  /orders/{id}            -> OrderDetailOut
 *   POST /orders/{id}/cancel     -> OrderDetailOut
 *   POST /orders/{id}/review     -> ReviewOut
 *   GET  /orders/{id}/track      -> OrderTrackOut
 *   GET  /orders/track/{token}   -> OrderTrackOut  (public share link; no auth)
 *
 * Query-key conventions follow `QK.orders.*` from `@/lib/constants`.
 * Mutation side-effects invalidate both the list and the detail keys.
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

import type {
  OrderDetailOut,
  OrderListItem,
  OrderStatus,
  OrderTrackOut,
  PageOut,
  ReviewIn,
  ReviewOut,
} from './types';

/* -------------------------------------------------------------------------- */
/*                                 Queries                                    */
/* -------------------------------------------------------------------------- */
export interface OrdersQueryParams {
  /** Server supports single-status filter; list page passes comma-joined set. */
  status?: string | undefined;
}

/** Paginated list of the current user's orders (most-recent first). */
export function useOrdersQuery(
  params: OrdersQueryParams = {},
): UseQueryResult<PageOut<OrderListItem>> {
  return useQuery({
    queryKey: QK.orders.list(params.status),
    queryFn: () =>
      api.get<PageOut<OrderListItem>>('/orders', {
        query: { status: params.status },
      }),
    // Keep list snappy but not stale — 30s matches the provider default.
    staleTime: 30_000,
  });
}

/** Full order detail. `enabled` gates on a truthy id so the hook is safe to
 *  call during render transitions (e.g. after navigation). */
export function useOrderDetailQuery(
  id: string | undefined,
): UseQueryResult<OrderDetailOut> {
  return useQuery({
    queryKey: QK.orders.detail(id ?? ''),
    queryFn: () => api.get<OrderDetailOut>(`/orders/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Lightweight polling fallback for live tracking. The caller passes either an
 * order id (authed /orders/:id/track) **or** a public share token — the hook
 * routes to the correct endpoint via `isPublicToken`.
 *
 * Phase 4 replaces this with a WebSocket push; the interface stays identical.
 */
export function useOrderTrackQuery(
  idOrToken: string | undefined,
  options?: { refetchInterval?: number; isPublicToken?: boolean },
): UseQueryResult<OrderTrackOut> {
  const interval = options?.refetchInterval ?? 10_000;
  const isPublic = options?.isPublicToken === true;
  return useQuery({
    queryKey: ['orders', 'track', idOrToken ?? '', isPublic] as const,
    queryFn: () =>
      api.get<OrderTrackOut>(
        isPublic ? `/orders/track/${idOrToken}` : `/orders/${idOrToken}/track`,
        // Public share link skips the Authorization header so non-logged-in
        // viewers can still see courier progress.
        isPublic ? { skipAuth: true } : undefined,
      ),
    enabled: Boolean(idOrToken),
    refetchInterval: interval,
    // Keep polling while tab is backgrounded so notifications stay fresh.
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

/* -------------------------------------------------------------------------- */
/*                                Mutations                                   */
/* -------------------------------------------------------------------------- */

/**
 * POST /orders/{id}/cancel — backend returns the updated `OrderDetailOut`.
 * We seed the detail cache from the mutation response so the UI flips status
 * to `cancelled` without an extra round-trip, then invalidate the list key
 * so "Active" tab re-fetches.
 */
export function useCancelOrderMutation(): UseMutationResult<
  OrderDetailOut,
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<OrderDetailOut>(`/orders/${id}/cancel`),
    onSuccess: (data) => {
      qc.setQueryData(QK.orders.detail(data.id), data);
      void qc.invalidateQueries({ queryKey: QK.orders.all });
    },
  });
}

/**
 * POST /orders/{id}/review — writes a customer review once the order is
 * delivered. Invalidates the detail query so the "review submitted" state
 * repaints (the button hides + the stored review shows).
 */
export function useCreateReviewMutation(): UseMutationResult<
  ReviewOut,
  Error,
  { orderId: string; body: ReviewIn }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, body }) =>
      api.post<ReviewOut>(
        `/orders/${orderId}/review`,
        body as unknown as Record<string, unknown>,
      ),
    onSuccess: (_review, { orderId }) => {
      void qc.invalidateQueries({ queryKey: QK.orders.detail(orderId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                             Filter serialisation                           */
/* -------------------------------------------------------------------------- */
/**
 * Pure helper — composes the CSV `status` param for the list endpoint. Kept
 * outside the hook so unit tests can exercise it without React. Passing
 * an empty array returns `undefined` so the query param is dropped entirely.
 */
export function joinStatuses(statuses: readonly OrderStatus[]): string | undefined {
  if (statuses.length === 0) return undefined;
  return statuses.join(',');
}

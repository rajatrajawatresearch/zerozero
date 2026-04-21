/**
 * TanStack Query mutations for the dev-only `/partner/*` surface.
 *
 * Every route here is `Depends(require_role(PARTNER, ADMIN))` on the
 * backend — callers MUST gate the UI on role before invoking. No public
 * partner routes exist.
 *
 * Endpoints (prefix `/api/v1` baked into `api.baseUrl`):
 *   POST /partner/online                  -> PartnerOnlineOut
 *   POST /partner/location                -> 204
 *   POST /partner/orders/{id}/accept      -> OrderDetailOut
 *   POST /partner/orders/{id}/status?s=X  -> OrderDetailOut
 *
 * Side-effects: a `status` POST fans out on `orders:{id}` + `public:{token}`
 * Redis channels, so after mutation we invalidate the corresponding order
 * detail/track keys so the customer-side UI (if open in another tab) picks
 * up the change on next focus.
 */
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api';
import { QK } from '@/lib/constants';
import type { OrderDetailOut } from '@/features/orders/types';

import type {
  PartnerLocationBatchIn,
  PartnerLocationPoint,
  PartnerOnlineIn,
  PartnerOnlineOut,
  PartnerStatusStep,
} from './types';

/* -------------------------------------------------------------------------- */
/*                              POST /partner/online                          */
/* -------------------------------------------------------------------------- */
/** Flip the partner availability flag on + seed a location fix. */
export function useGoOnlineMutation(): UseMutationResult<
  PartnerOnlineOut,
  Error,
  PartnerOnlineIn
> {
  return useMutation<PartnerOnlineOut, Error, PartnerOnlineIn>({
    mutationFn: (body) =>
      api.post<PartnerOnlineOut>(
        '/partner/online',
        body as unknown as Record<string, unknown>,
      ),
  });
}

/* -------------------------------------------------------------------------- */
/*                             POST /partner/location                         */
/* -------------------------------------------------------------------------- */
/**
 * Ship a batch of breadcrumbs. Returns void (204). The hook exposes the
 * underlying mutation so callers can stitch it into a polling loop without
 * juggling query-client boilerplate.
 */
export function usePushLocationMutation(): UseMutationResult<
  void,
  Error,
  PartnerLocationBatchIn
> {
  return useMutation<void, Error, PartnerLocationBatchIn>({
    mutationFn: (body) =>
      api.post<void>(
        '/partner/location',
        body as unknown as Record<string, unknown>,
      ),
  });
}

/** Convenience: ship a single point by wrapping it in the batch envelope. */
export async function pushSingleLocation(point: PartnerLocationPoint): Promise<void> {
  await api.post<void>('/partner/location', { points: [point] });
}

/* -------------------------------------------------------------------------- */
/*                       POST /partner/orders/{id}/accept                     */
/* -------------------------------------------------------------------------- */
/** Partner accepts an assigned order. Mutates the detail cache on success. */
export function useAcceptOrderMutation(): UseMutationResult<
  OrderDetailOut,
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation<OrderDetailOut, Error, string>({
    mutationFn: (id) => api.post<OrderDetailOut>(`/partner/orders/${id}/accept`),
    onSuccess: (data) => {
      qc.setQueryData(QK.orders.detail(data.id), data);
      void qc.invalidateQueries({ queryKey: QK.orders.all });
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                       POST /partner/orders/{id}/status                     */
/* -------------------------------------------------------------------------- */
/**
 * Advance an order through the delivery lifecycle. The server publishes to
 * `orders:{id}` + `public:{share_token}`; the local query cache is seeded
 * from the response so the partner UI flips instantly.
 */
export function useAdvanceStatusMutation(): UseMutationResult<
  OrderDetailOut,
  Error,
  { orderId: string; status: PartnerStatusStep }
> {
  const qc = useQueryClient();
  return useMutation<OrderDetailOut, Error, { orderId: string; status: PartnerStatusStep }>({
    mutationFn: ({ orderId, status }) =>
      api.post<OrderDetailOut>(
        `/partner/orders/${orderId}/status`,
        undefined,
        { query: { s: status } },
      ),
    onSuccess: (data) => {
      qc.setQueryData(QK.orders.detail(data.id), data);
      void qc.invalidateQueries({ queryKey: QK.orders.all });
      // Invalidate the lightweight track query so any customer-side tab
      // that's polling picks up the new status on its next tick.
      void qc.invalidateQueries({ queryKey: ['orders', 'track', data.id, false] });
    },
  });
}

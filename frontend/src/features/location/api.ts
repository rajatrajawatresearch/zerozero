/**
 * TanStack Query hooks for the Location feature.
 *
 * Two axes here:
 *  1. Public geocoding (`/geo/*`) — no auth required, cached aggressively
 *     because Nominatim results rarely change and we're already paying
 *     rate-limiting penalties on the backend.
 *  2. Authed addresses (`/users/me/addresses`) — gated on `accessToken`
 *     via the `enabled` option so logged-out users don't spam 401s.
 *
 * Mutation side-effects invalidate the `QK.addresses.mine` key so any
 * mounted `AddressList` repaints with fresh data automatically.
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

import type { Address, AddressIn, AddressPatch, Place } from './types';

/* -------------------------------------------------------------------------- */
/*                                 Geocoding                                  */
/* -------------------------------------------------------------------------- */

/** Query-key helpers for geocoding. Kept local; not broadcast into `QK`. */
const geoKeys = {
  search: (q: string) => ['geo', 'search', q] as const,
  reverse: (lat: number, lng: number) => ['geo', 'reverse', lat, lng] as const,
};

/**
 * Autocomplete over Nominatim via our backend proxy.
 *
 * Call sites typically debounce `q` with `useDebouncedValue` to avoid
 * hammering the upstream rate-limiter. `enabled` should be set to
 * `q.trim().length >= 2` by the caller.
 */
export function useGeoSearchQuery(
  q: string,
  enabled: boolean,
): UseQueryResult<Place[]> {
  return useQuery({
    queryKey: geoKeys.search(q),
    queryFn: () => api.get<Place[]>('/geo/search', { query: { q } }),
    enabled: enabled && q.trim().length > 0,
    // Nominatim results are stable enough to cache for 10 min.
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/** Reverse geocode a lat/lng pair into a `Place`. */
export function useGeoReverseQuery(
  lat: number | null,
  lng: number | null,
  enabled: boolean,
): UseQueryResult<Place> {
  return useQuery({
    queryKey: geoKeys.reverse(lat ?? 0, lng ?? 0),
    queryFn: () =>
      // `enabled` guards against null; coerce with `?? 0` to keep the type
      // checker happy without an assertion.
      api.get<Place>('/geo/reverse', {
        query: { lat: lat ?? 0, lng: lng ?? 0 },
      }),
    enabled: enabled && lat !== null && lng !== null,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/* -------------------------------------------------------------------------- */
/*                                 Addresses                                  */
/* -------------------------------------------------------------------------- */

/** List the current user's saved addresses. Disabled when signed-out. */
export function useAddressesQuery(): UseQueryResult<Address[]> {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: QK.addresses.mine,
    queryFn: () => api.get<Address[]>('/users/me/addresses'),
    enabled: !!accessToken,
    staleTime: 60 * 1000,
  });
}

/** POST /users/me/addresses — creates a new address. */
export function useCreateAddressMutation(): UseMutationResult<
  Address,
  Error,
  AddressIn
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddressIn) =>
      api.post<Address>('/users/me/addresses', body as unknown as Record<string, unknown>),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.addresses.mine });
    },
  });
}

/** PATCH /users/me/addresses/{id}. */
export function useUpdateAddressMutation(): UseMutationResult<
  Address,
  Error,
  { id: string; patch: AddressPatch }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) =>
      api.patch<Address>(
        `/users/me/addresses/${id}`,
        patch as unknown as Record<string, unknown>,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.addresses.mine });
    },
  });
}

/** DELETE /users/me/addresses/{id}. */
export function useDeleteAddressMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/users/me/addresses/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.addresses.mine });
    },
  });
}

/**
 * POST /users/me/addresses/{id}/default — marks the address as default and
 * clears the flag on any prior default (server-side, atomically).
 */
export function useSetDefaultAddressMutation(): UseMutationResult<
  Address,
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Address>(`/users/me/addresses/${id}/default`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.addresses.mine });
    },
  });
}

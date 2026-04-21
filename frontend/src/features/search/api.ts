/**
 * TanStack Query hook for the Search slice.
 *
 *   GET /search?q=&lat=&lng=&type= -> SearchResults
 *
 * The hook does NOT debounce internally — callers pass a pre-debounced
 * value (via `useDebouncedValue`) and gate firing with `enabled`. This
 * keeps the hook pure and reuses the debounce primitive already shipped
 * by the Location slice.
 *
 * Query-key convention:
 *   ['search', q, params.type, params.lat, params.lng]
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { SearchParams, SearchResults } from './types';

/* -------------------------------------------------------------------------- */
/*                                 Query key                                  */
/* -------------------------------------------------------------------------- */
export const searchKeys = {
  all: ['search'] as const,
  query: (q: string, params: SearchParams) =>
    ['search', q, params.type ?? 'all', params.lat ?? null, params.lng ?? null] as const,
};

/* -------------------------------------------------------------------------- */
/*                                 Serialiser                                 */
/* -------------------------------------------------------------------------- */
function serialise(
  q: string,
  params: SearchParams,
): Record<string, string | number | boolean | undefined> {
  const out: Record<string, string | number | boolean | undefined> = { q };
  if (params.lat !== undefined) out.lat = params.lat;
  if (params.lng !== undefined) out.lng = params.lng;
  if (params.type !== undefined && params.type !== 'all') out.type = params.type;
  return out;
}

/* -------------------------------------------------------------------------- */
/*                                   Hook                                     */
/* -------------------------------------------------------------------------- */
/**
 * Global search query.
 *
 *  - `q` is the trimmed, debounced search term; callers are responsible
 *    for both (see `useDebouncedValue`).
 *  - `params` carries optional geo + type narrowing.
 *  - `options.enabled` gates firing (typically `q.length >= 2`).
 *
 * The query is marked public (`skipAuth: true`) so the palette works for
 * logged-out visitors.
 */
export function useGlobalSearchQuery(
  q: string,
  params: SearchParams = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<SearchResults> {
  const enabled = (options.enabled ?? true) && q.trim().length >= 2;

  return useQuery({
    queryKey: searchKeys.query(q, params),
    queryFn: () =>
      api.get<SearchResults>('/search', {
        query: serialise(q, params),
        skipAuth: true,
      }),
    enabled,
    // Typing is noisy; keep results around briefly so Backspace re-hits cache.
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

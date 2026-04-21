/**
 * TanStack Query hooks for the Restaurants slice.
 *
 * Endpoints (prefix `/api/v1` baked into `api.baseUrl`):
 *   GET /restaurants           -> PageOut<RestaurantCard>
 *   GET /restaurants/{slug}    -> RestaurantDetail
 *   GET /restaurants/{slug}/menu -> RestaurantMenu
 *   GET /cuisines              -> Cuisine[]
 *   GET /categories            -> Category[]
 *
 * Query-key conventions (Phase 2 contract):
 *   ['restaurants', params]
 *   ['restaurants', slug]
 *   ['restaurants', slug, 'menu']
 *   ['cuisines']
 *   ['categories']
 */
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  Category,
  Cuisine,
  PageOut,
  RestaurantCard,
  RestaurantDetail,
  RestaurantListParams,
  RestaurantMenu,
} from './types';

/* -------------------------------------------------------------------------- */
/*                               Param serialisers                            */
/* -------------------------------------------------------------------------- */
/**
 * Translate the client's `RestaurantListParams` (arrays, camelCase) into the
 * flat `string` dictionary the ApiClient's `query` option expects. Keeping
 * this pure so it can be unit-tested independently of React.
 */
export function serialiseListParams(
  params: RestaurantListParams,
): Record<string, string | number | boolean | undefined> {
  const out: Record<string, string | number | boolean | undefined> = {};
  if (params.lat !== undefined) out.lat = params.lat;
  if (params.lng !== undefined) out.lng = params.lng;
  if (params.cuisine && params.cuisine.length > 0) {
    // Backend accepts CSV for multi-select cuisines.
    out.cuisine = params.cuisine.join(',');
  }
  if (params.q !== undefined && params.q.length > 0) out.q = params.q;
  if (params.veg !== undefined) out.veg = params.veg;
  if (params.sort !== undefined) out.sort = params.sort;
  if (params.page !== undefined) out.page = params.page;
  if (params.pageSize !== undefined) out.page_size = params.pageSize;
  return out;
}

/* -------------------------------------------------------------------------- */
/*                                    Hooks                                   */
/* -------------------------------------------------------------------------- */

/** Paginated restaurant list. Pass at least `lat`/`lng` for distance-sorted defaults. */
export function useRestaurantsQuery(params: RestaurantListParams) {
  return useQuery({
    queryKey: ['restaurants', params],
    queryFn: () =>
      api.get<PageOut<RestaurantCard>>('/restaurants', {
        query: serialiseListParams(params),
        skipAuth: true,
      }),
    // Keep list fresh across filter toggles but don't hammer on rapid typing;
    // feature-level staleTime reuses the global 30s default set in query-client.
  });
}

/** Single-restaurant detail by slug. */
export function useRestaurantDetailQuery(slug: string | undefined) {
  return useQuery({
    queryKey: ['restaurants', slug],
    queryFn: () =>
      api.get<RestaurantDetail>(`/restaurants/${slug}`, { skipAuth: true }),
    enabled: Boolean(slug),
  });
}

/** Full menu (categories -> items) for a restaurant slug. */
export function useRestaurantMenuQuery(slug: string | undefined) {
  return useQuery({
    queryKey: ['restaurants', slug, 'menu'],
    queryFn: () =>
      api.get<RestaurantMenu>(`/restaurants/${slug}/menu`, { skipAuth: true }),
    enabled: Boolean(slug),
  });
}

/** Cuisine taxonomy — rarely changes, so we cache it for 5 minutes. */
export function useCuisinesQuery() {
  return useQuery({
    queryKey: ['cuisines'],
    queryFn: () => api.get<Cuisine[]>('/cuisines', { skipAuth: true }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

/** Category taxonomy — rarely changes, cached alongside cuisines. */
export function useCategoriesQuery() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories', { skipAuth: true }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

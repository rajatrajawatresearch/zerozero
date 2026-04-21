/**
 * TanStack Query hooks for the Reviews slice.
 *
 * Endpoints (prefix `/api/v1` baked into `api.baseUrl`):
 *   GET /restaurants/{slug}/reviews?page=1&page_size=10   → PageOut<ReviewOut>
 *
 * The list is infinite-paginated — the page size defaults to 10 to match the
 * backend's list-page default and the "show 10 more" UX of the ReviewList.
 * We use `useInfiniteQuery` so the component can flatten pages + drive a
 * single "Load more" button.
 *
 * Query keys live under `['reviews', 'restaurant', slug]` — siblings can
 * invalidate via that prefix when a new review lands (Phase 4 creates an
 * aggregate-recompute in the backend so the prefix also covers the
 * restaurant detail cache).
 */
import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { ReviewPage } from './types';

/* -------------------------------------------------------------------------- */
/*                                 Query keys                                 */
/* -------------------------------------------------------------------------- */
export const reviewsKeys = {
  all: ['reviews'] as const,
  restaurant: (slug: string) => ['reviews', 'restaurant', slug] as const,
  restaurantList: (slug: string, pageSize: number) =>
    ['reviews', 'restaurant', slug, { pageSize }] as const,
} as const;

/* -------------------------------------------------------------------------- */
/*                                   Params                                   */
/* -------------------------------------------------------------------------- */
export interface UseRestaurantReviewsQueryOptions {
  /** Initial page (defaults to 1). */
  page?: number;
  /** Page size — backend caps at 50. Keep small for snappy first paint. */
  pageSize?: number;
  /** Allow the caller to disable the query conditionally. */
  enabled?: boolean;
}

/**
 * Paginated restaurant reviews — infinite-query flavour so the consumer can
 * flatten `data.pages` and render a single scrollable list.
 *
 * Empty `slug` disables the query entirely; TanStack still caches the empty
 * state so a quick slug flip doesn't trigger a flash of "no reviews yet".
 */
export function useRestaurantReviewsQuery(
  slug: string | undefined,
  options: UseRestaurantReviewsQueryOptions = {},
): UseInfiniteQueryResult<{ pages: ReviewPage[]; pageParams: number[] }> {
  const pageSize = options.pageSize ?? 10;
  const initialPage = options.page ?? 1;
  const enabled = options.enabled ?? Boolean(slug);

  return useInfiniteQuery({
    queryKey: reviewsKeys.restaurantList(slug ?? '', pageSize),
    initialPageParam: initialPage,
    queryFn: ({ pageParam }) =>
      api.get<ReviewPage>(`/restaurants/${slug}/reviews`, {
        skipAuth: true,
        query: { page: pageParam, page_size: pageSize },
      }),
    getNextPageParam: (lastPage) =>
      lastPage.has_next ? lastPage.page + 1 : undefined,
    enabled,
    // Reviews don't move much — 5 minutes is plenty and keeps tab re-entry snappy.
    staleTime: 5 * 60_000,
  });
}

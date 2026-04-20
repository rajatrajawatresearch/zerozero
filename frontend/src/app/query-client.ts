import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client for the whole app.
 *
 * Defaults mirror the recommendations in `docs/MASTER_PLAN.md` Phase 1B:
 *  - `staleTime: 30_000` — 30s of "fresh" before a background refetch fires
 *  - `retry: 1` — one silent retry on network flakiness
 *  - `refetchOnWindowFocus: false` — avoids re-fetching heavy lists every
 *    time the user alt-tabs; pages that need this (e.g. live order list)
 *    opt in explicitly via `useQuery({ refetchOnWindowFocus: true })`
 *
 * Per ZeroZero rule #10 ("Real-time state flows through TanStack Query
 * cache"), WS handlers in Phase 4 will call `queryClient.setQueryData`
 * directly — no separate realtime store.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

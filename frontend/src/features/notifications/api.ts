/**
 * TanStack Query hooks for the Notifications slice.
 *
 * Query keys mirror the constant factory in `@/lib/constants.ts`:
 *   ['notifications']                                   — top-level prefix
 *   ['notifications', 'list', { unread?, page? }]       — paginated list
 *   ['notifications', 'unread-count']                   — badge count
 *
 * Invalidation strategy:
 *  - Marking a single notification as read updates both the list + count
 *    atomically via `setQueryData` so the UI flips without a refetch.
 *  - Mark-all-read invalidates the whole prefix so pages drop their "unread"
 *    filter view and refetch cleanly.
 *  - WS pushes (see `hooks.ts::useNotificationsSocket`) call
 *    `invalidateQueries({ queryKey: ['notifications'] })` so every cached
 *    shape (filtered + unfiltered) refetches. Per ZeroZero rule #10 all
 *    real-time state flows through the query cache, not a side-channel store.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

import type {
  NotificationOut,
  NotificationPage,
  UnreadCountOut,
} from './types';

/* -------------------------------------------------------------------------- */
/*                                 Query keys                                 */
/* -------------------------------------------------------------------------- */
export const notificationsKeys = {
  all: ['notifications'] as const,
  list: (params: NotificationsQueryParams) =>
    ['notifications', 'list', params] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
} as const;

/* -------------------------------------------------------------------------- */
/*                                   Queries                                  */
/* -------------------------------------------------------------------------- */
export interface NotificationsQueryParams {
  /** Filter to unread-only (omit for all). */
  unread?: boolean;
  /** 1-indexed page. */
  page?: number;
  /** Page size; backend caps at 50. */
  pageSize?: number;
}

/** Paginated list of the current user's notifications (most-recent first). */
export function useNotificationsQuery(
  params: NotificationsQueryParams = {},
): UseQueryResult<NotificationPage> {
  return useQuery({
    queryKey: notificationsKeys.list(params),
    queryFn: () =>
      api.get<NotificationPage>('/notifications', {
        query: {
          unread: params.unread === true ? true : undefined,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 20,
        },
      }),
    // Short staleTime — WS invalidates on push, but in the no-WS fallback we
    // still want a snappy refetch when the sheet re-opens.
    staleTime: 30_000,
  });
}

/**
 * Unread-count poll for the header bell. WS pushes invalidate this too, so
 * the polling interval is a belt-and-braces — not a primary data source.
 */
export function useUnreadCountQuery(): UseQueryResult<UnreadCountOut> {
  return useQuery({
    queryKey: notificationsKeys.unreadCount,
    queryFn: () =>
      api.get<UnreadCountOut>('/notifications/unread-count'),
    // 1-minute poll keeps the badge honest even if the WS disconnects.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/* -------------------------------------------------------------------------- */
/*                                 Mutations                                  */
/* -------------------------------------------------------------------------- */

/**
 * Flip a single notification to read. Server returns 204; we optimistically
 * patch every cached list so the UI flips instantly. If the request fails,
 * `onError` falls back to invalidation — cheaper than tracking rollback state.
 */
export function useMarkReadMutation(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<void>(`/notifications/${id}/read`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: notificationsKeys.all });
      // Flip the item in every matching list cache we hold.
      const listQueries = qc.getQueriesData<NotificationPage>({
        queryKey: ['notifications', 'list'],
      });
      for (const [key, data] of listQueries) {
        if (!data) continue;
        qc.setQueryData<NotificationPage>(key, {
          ...data,
          items: data.items.map((n) =>
            n.id === id && !n.is_read ? { ...n, is_read: true } : n,
          ),
        });
      }
      // Decrement the badge count if present.
      const count = qc.getQueryData<UnreadCountOut>(notificationsKeys.unreadCount);
      if (count && count.count > 0) {
        qc.setQueryData<UnreadCountOut>(notificationsKeys.unreadCount, {
          count: count.count - 1,
        });
      }
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: notificationsKeys.all });
    },
  });
}

/** Mark every unread notification as read in one call. */
export function useMarkAllReadMutation(): UseMutationResult<void, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/notifications/read-all'),
    onSuccess: () => {
      // Clear the badge immediately…
      qc.setQueryData<UnreadCountOut>(notificationsKeys.unreadCount, { count: 0 });
      // …and refetch any open list so persisted notifications show as read.
      void qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                        WS-driven cache merge helper                        */
/* -------------------------------------------------------------------------- */
/**
 * Merge a freshly-arrived notification into the cache without a refetch.
 * Used by `useNotificationsSocket` (see `hooks.ts`) for the hot path.
 *
 * Split out so it's unit-testable (no React) and callable from Storybook
 * fixtures that want to inject fake pushes.
 */
export function mergeIncomingNotification(
  qc: ReturnType<typeof useQueryClient>,
  notification: NotificationOut,
): void {
  const listQueries = qc.getQueriesData<NotificationPage>({
    queryKey: ['notifications', 'list'],
  });
  for (const [key, data] of listQueries) {
    if (!data) continue;
    // De-dupe — if the server replays the same id, drop the duplicate.
    if (data.items.some((n) => n.id === notification.id)) continue;
    qc.setQueryData<NotificationPage>(key, {
      ...data,
      items: [notification, ...data.items],
      total: data.total + 1,
    });
  }
  if (!notification.is_read) {
    const count = qc.getQueryData<UnreadCountOut>(notificationsKeys.unreadCount);
    qc.setQueryData<UnreadCountOut>(notificationsKeys.unreadCount, {
      count: (count?.count ?? 0) + 1,
    });
  }
}

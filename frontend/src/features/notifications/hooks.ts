/**
 * Feature-local hooks for the Notifications slice.
 *
 * `useNotificationsSocket` opens a single WebSocket to `/ws/notifications`
 * and lets TanStack Query's cache be the source of truth (per ZeroZero
 * rule #10 — real-time state flows through the query cache, not a separate
 * store).
 *
 * On message we either:
 *   - merge the incoming notification into every cached list (cheap, no
 *     network round-trip), OR
 *   - fall back to broad invalidation if we don't recognise the event shape.
 *
 * The socket is owned by the `<NotificationBell />` in the header so there's
 * exactly one connection per tab regardless of how many sheets/lists are
 * mounted. Consumers therefore don't need to worry about duplicates.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { env } from '@/lib/env';
import { ReconnectingWS, type WsState } from '@/lib/ws';
import { useAuthStore } from '@/store/auth';

import { mergeIncomingNotification, notificationsKeys } from './api';
import type { NotificationOut, NotificationWsEvent, UnreadCountOut } from './types';

/* -------------------------------------------------------------------------- */
/*                                 Return shape                               */
/* -------------------------------------------------------------------------- */
export interface NotificationsSocketSnapshot {
  /** Latest socket state — callers can show a "reconnecting" dot. */
  state: WsState;
}

/**
 * Subscribe to the notifications push channel. No-ops when unauthenticated
 * — the WS endpoint requires a token and would reject an anon connection
 * with 4401 anyway.
 *
 * Returning a snapshot rather than events keeps consumers simple: the
 * Query cache already holds the canonical list, so they read from hooks
 * in `api.ts` and only use this for the "live" dot indicator.
 */
export function useNotificationsSocket(): NotificationsSocketSnapshot {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = Boolean(accessToken);

  const [state, setState] = useState<WsState>('closed');
  const wsRef = useRef<ReconnectingWS | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setState('closed');
      return;
    }

    const token = accessToken ?? undefined;
    const ws = new ReconnectingWS(`${env.WS_BASE_URL}/notifications`, {
      ...(token ? { token } : {}),
      onOpen: () => setState('open'),
      onClose: () => setState('closed'),
      onError: () => setState('reconnecting'),
      onMessage: (raw) => {
        const msg = raw as NotificationWsEvent | { type: string };

        if (
          msg &&
          typeof msg === 'object' &&
          'type' in msg &&
          msg.type === 'notification' &&
          'notification' in msg
        ) {
          const n = (msg as { notification: NotificationOut }).notification;
          // Fast path — merge without a network round-trip.
          mergeIncomingNotification(queryClient, n);
          return;
        }

        if (
          msg &&
          typeof msg === 'object' &&
          'type' in msg &&
          msg.type === 'unread_count' &&
          'count' in msg
        ) {
          queryClient.setQueryData<UnreadCountOut>(
            notificationsKeys.unreadCount,
            { count: Number((msg as { count: number }).count) },
          );
          return;
        }

        // Unknown shape — fall back to broad invalidation so the cache
        // catches up on the next paint.
        void queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
      },
    });
    wsRef.current = ws;
    setState('connecting');

    return () => {
      ws.close();
      wsRef.current = null;
      setState('closed');
    };
    // We *intentionally* skip `queryClient` in deps — it's stable per-provider
    // and re-connecting on every render would be a bug. Same pattern as
    // `useOrderSocket` in `@/lib/ws`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, accessToken]);

  return { state };
}

/**
 * Notifications feature TS mirrors of backend Pydantic v2 schemas.
 *
 * Contract source: `docs/PHASE4_CONTRACTS.md` — Notifications section.
 *
 * Backend endpoints:
 *   GET    /notifications?unread=true&page=1   → PageOut<NotificationOut>
 *   POST   /notifications/{id}/read            → 204
 *   POST   /notifications/read-all             → 204
 *   GET    /notifications/unread-count         → { count: int }
 *
 * Websocket: `/ws/notifications?token=X` pushes new notifications live.
 *
 * Wire format stays snake_case — same policy as every other slice in this
 * app (see `features/orders/types.ts` for the rationale).
 */
import type { PageOut } from '@/features/orders/types';

/* -------------------------------------------------------------------------- */
/*                                    Type                                    */
/* -------------------------------------------------------------------------- */
/** Discriminator for icon + accent selection in `NotificationItem`. */
export type NotificationType = 'order_status' | 'promo' | 'generic';

/**
 * Single notification as served by the list endpoint. `payload` holds
 * type-specific data — e.g. `{ order_id, status }` for `order_status`.
 */
export interface NotificationOut {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

/** Unread-count envelope as returned by the dedicated endpoint. */
export interface UnreadCountOut {
  count: number;
}

/** Wire message shape pushed by `/ws/notifications`. */
export type NotificationWsEvent =
  | { type: 'notification'; notification: NotificationOut }
  | { type: 'unread_count'; count: number }
  | { type: 'ping' }
  | { type: 'pong' };

/** Re-export paginated envelope so callers don't need two imports. */
export type NotificationPage = PageOut<NotificationOut>;

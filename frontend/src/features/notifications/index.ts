/**
 * Public barrel for the Notifications feature slice.
 *
 * This slice intentionally ships **no** routes — the bell lives in the
 * global header and the list surface is a right-side sheet, so routing is
 * unnecessary. Agent 10 (this agent) mounts `<NotificationBell />` into
 * `components/layout/Header.tsx` inside the authenticated branch.
 *
 * `useNotificationsSocket` is re-exported so Phase 4's higher-level screens
 * (e.g. a full notifications centre later) can subscribe without going
 * through the bell.
 */
export * from './types';
export * from './api';
export * from './hooks';

export { NotificationBell } from './components/NotificationBell';
export { NotificationsSheet } from './components/NotificationsSheet';
export { NotificationItem } from './components/NotificationItem';

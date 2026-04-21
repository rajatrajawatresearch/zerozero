import type { RouteObject } from 'react-router';

/**
 * Orders feature routes — merged into the app-level route table by
 * Agent 10 (FE-Layout) via `features/routes.tsx`.
 *
 * Each route uses React Router v7's `lazy` property so the pages are
 * code-split automatically: the map/Leaflet bundles pulled in by
 * `TrackingMap` stay out of the main landing-page payload.
 *
 * Note: the public track page (`/track/:shareToken`) intentionally lives
 * **outside** the AppShell in the caller's merge logic — Agent 10 decides
 * whether to render it with or without chrome.
 */
export const orderRoutes: RouteObject[] = [
  {
    path: '/orders',
    lazy: () =>
      import('./pages/OrdersListPage.tsx').then((m) => ({ Component: m.default })),
  },
  {
    path: '/orders/:id',
    lazy: () =>
      import('./pages/OrderDetailPage.tsx').then((m) => ({ Component: m.default })),
  },
  {
    path: '/track/:shareToken',
    lazy: () =>
      import('./pages/PublicTrackPage.tsx').then((m) => ({ Component: m.default })),
  },
];

export default orderRoutes;

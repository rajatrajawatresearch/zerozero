/**
 * Route table for the Checkout feature.
 *
 * Agent 10 (FE-Layout) merges `checkoutRoutes` into the root router. The
 * `/checkout` page is auth-gated internally via `<ProtectedRoute>`, so we
 * don't wrap it again here — keeping the route spec flat and lazy-load
 * friendly.
 */
import type { RouteObject } from 'react-router';

export const checkoutRoutes: RouteObject[] = [
  {
    path: '/checkout',
    lazy: () =>
      import('./pages/CheckoutPage.tsx').then((m) => ({ Component: m.default })),
  },
];

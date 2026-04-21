/**
 * Route definitions owned by the auth feature slice.
 *
 * These are consumed by Agent 10 (FE-Layout) which spreads them into the
 * root route table in `features/routes.ts`. Every route uses the v7
 * `lazy` module-descriptor form so the auth pages are code-split out of
 * the initial bundle.
 */
import type { RouteObject } from 'react-router';

export const authRoutes: RouteObject[] = [
  {
    path: '/login',
    lazy: () =>
      import('./pages/LoginPage').then((m) => ({ Component: m.default })),
  },
  {
    path: '/signup',
    lazy: () =>
      import('./pages/SignupPage').then((m) => ({ Component: m.default })),
  },
];

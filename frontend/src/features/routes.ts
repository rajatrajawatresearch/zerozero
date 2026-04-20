import type { RouteObject } from 'react-router';

/**
 * Minimal Phase-1 route table — just a landing page and a 404.
 * Phase 2+ feature tracks (auth, restaurants, orders, etc.) will each
 * add their own routes via their feature folder.
 *
 * Convention: every feature exports a `routes` array that is spread
 * into this file; keep the path ordering top-down (public → auth-only
 * → admin) so matching stays predictable.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    lazy: () =>
      import('./_placeholder/HomePage.tsx').then((m) => ({ Component: m.default })),
  },
  {
    path: '*',
    lazy: () =>
      import('./_placeholder/NotFoundPage.tsx').then((m) => ({
        Component: m.default,
      })),
  },
];

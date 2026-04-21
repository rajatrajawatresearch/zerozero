import type { RouteObject } from 'react-router';

/**
 * Route table for the Search feature. Merged into the app-level route
 * table by Agent 10 (FE-Search, this slice) via `features/routes.tsx`.
 * Lazy-loaded so the full search page (Tabs, cards) stays out of the
 * initial bundle — the Command palette is the only search surface that
 * ships with the shell.
 */
export const searchRoutes: RouteObject[] = [
  {
    path: '/search',
    lazy: () =>
      import('./pages/SearchPage.tsx').then((m) => ({ Component: m.default })),
  },
];

export default searchRoutes;

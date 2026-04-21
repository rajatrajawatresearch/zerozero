import type { RouteObject } from 'react-router';

/**
 * Cart feature routes — Agent 10 (FE-Search / route merge) spreads these
 * into the root table in `features/routes.tsx`, replacing the Phase 2
 * placeholder `/cart` stub. The page is code-split via v7 `lazy`.
 */
export const cartRoutes: RouteObject[] = [
  {
    path: '/cart',
    lazy: () =>
      import('./pages/CartPage.tsx').then((m) => ({ Component: m.default })),
  },
];

export default cartRoutes;

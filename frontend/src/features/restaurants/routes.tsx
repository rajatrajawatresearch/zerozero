import type { RouteObject } from 'react-router';

/**
 * Restaurant feature routes — merged into the app-level route table by
 * Agent 10 (FE-Layout) via `features/routes.ts`. We only own the detail
 * route here; the restaurant list is wired up by the layout coordinator
 * into `HomePage` so it composes with the shared header/footer shell.
 */
export const restaurantRoutes: RouteObject[] = [
  {
    path: '/r/:slug',
    lazy: () =>
      import('./pages/RestaurantDetailPage').then((m) => ({
        Component: m.default,
      })),
  },
];

export default restaurantRoutes;

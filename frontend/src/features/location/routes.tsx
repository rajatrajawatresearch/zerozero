/**
 * Route table for the Location feature.
 *
 * Agent 10 (FE-Layout) spreads `locationRoutes` into the root `routes`
 * export in `@/features/routes.ts`. Each route uses React Router v7's
 * `lazy` hook so the Leaflet bundle + map chunk stay out of the main
 * landing-page payload until the user actually navigates here.
 */
import type { RouteObject } from 'react-router';

export const locationRoutes: RouteObject[] = [
  {
    path: '/addresses',
    lazy: () =>
      import('./pages/AddressesPage').then((m) => ({ Component: m.default })),
  },
];

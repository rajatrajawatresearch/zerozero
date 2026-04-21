/**
 * Partner simulator route table — merged into the app-level route tree by
 * Agent 10 (FE-Layout) via `features/routes.tsx`.
 *
 * `/dev/partner` is intentionally NOT wrapped in `<ProtectedRoute>`: the
 * role check lives inside `PartnerSimPage` itself so an authenticated user
 * with the wrong role gets redirected to `/` rather than bounced through
 * the login flow.
 *
 * The page is code-split via v7 `lazy` so the simulator (and its
 * geolocation helpers) stay out of the customer-facing main bundle.
 */
import type { RouteObject } from 'react-router';

export const partnerSimRoutes: RouteObject[] = [
  {
    path: '/dev/partner',
    lazy: () =>
      import('./pages/PartnerSimPage').then((m) => ({ Component: m.default })),
  },
];

export default partnerSimRoutes;

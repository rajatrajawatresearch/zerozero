import type { RouteObject } from 'react-router';
import AppShell from '@/components/layout/AppShell';
import { authRoutes } from '@/features/auth';
import { restaurantRoutes } from '@/features/restaurants';
import { locationRoutes } from '@/features/location/routes';
import { cartRoutes } from '@/features/cart';
import { checkoutRoutes } from '@/features/checkout';
import { orderRoutes } from '@/features/orders';
import { searchRoutes } from '@/features/search';

/**
 * Root route table. Every path is nested under `<AppShell />` so the
 * header, footer, and mobile nav chrome render once and the child pages
 * slot into the `<main>` element via `<Outlet />`.
 *
 * Feature slices own their own `routes` arrays (code-split via v7 `lazy`);
 * this file is the single point where we merge them. Phase 3 ships the
 * Cart, Checkout, Orders, and Search slices — the placeholder "coming
 * soon" entries have been retired.
 *
 * Merge order matters only for `*` (the NotFound catch-all) which stays
 * last; everything else is path-addressed so the order is cosmetic.
 */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      {
        path: '/',
        lazy: () =>
          import('./home/HomePage').then((m) => ({ Component: m.default })),
      },
      ...authRoutes,
      ...restaurantRoutes,
      ...locationRoutes,
      ...cartRoutes,
      ...checkoutRoutes,
      ...orderRoutes,
      ...searchRoutes,

      /* ------------------------- Phase 2 hold-overs --------------------- */
      {
        path: '/profile',
        element: (
          <div className="mx-auto max-w-lg px-6 py-20 text-center text-muted-foreground">
            <h1 className="mb-2 text-2xl font-bold text-foreground">Profile</h1>
            <p>Profile settings are coming in Phase 4.</p>
          </div>
        ),
      },
      {
        path: '/settings',
        element: (
          <div className="mx-auto max-w-lg px-6 py-20 text-center text-muted-foreground">
            <h1 className="mb-2 text-2xl font-bold text-foreground">Settings</h1>
            <p>Preferences land in Phase 4.</p>
          </div>
        ),
      },
      {
        path: '/about',
        element: (
          <div className="mx-auto max-w-2xl px-6 py-20 text-center">
            <h1 className="mb-2 text-3xl font-bold text-foreground">About ZeroZero</h1>
            <p className="text-muted-foreground">
              A Zomato-style food delivery clone built in the open as a
              multi-phase learning project.
            </p>
          </div>
        ),
      },

      {
        path: '*',
        lazy: () =>
          import('./home/NotFound').then((m) => ({ Component: m.default })),
      },
    ],
  },
];

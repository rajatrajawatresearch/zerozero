import { createBrowserRouter } from 'react-router';
import { routes } from '@/features/routes';

/**
 * Application router. Route definitions live in `@/features/routes` so
 * that feature folders stay self-contained — the router file itself is
 * just wiring.
 *
 * React Router v7 supports the `lazy` property on route objects which
 * returns a module descriptor; this keeps code-splitting automatic with
 * zero dynamic-import boilerplate at the feature level.
 */
export const router = createBrowserRouter(routes);

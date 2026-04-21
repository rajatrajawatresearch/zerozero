/**
 * Gate component: render children only when an authenticated session is
 * present. While the bootstrap `/auth/me` query is resolving we show a
 * neutral spinner; when unauthenticated we redirect to `/login` and
 * preserve the attempted path under `state.from` so the login form can
 * bounce the user back on success.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Loader2 } from 'lucide-react';

import { useAuth } from '../hooks';

interface ProtectedRouteProps {
  children: ReactNode;
  /** Override the default `/login` redirect target. */
  redirectTo?: string;
}

export function ProtectedRoute({
  children,
  redirectTo = '/login',
}: ProtectedRouteProps): ReactNode {
  const location = useLocation();
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        className="flex min-h-[50vh] items-center justify-center text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
        <span className="sr-only">Loading your session</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={redirectTo} replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

export default ProtectedRoute;

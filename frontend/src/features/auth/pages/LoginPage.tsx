/**
 * Login route — centered card with branding + LoginForm.
 *
 * If a session already exists the user is redirected straight to `/`
 * (or to the `from` path preserved by `ProtectedRoute`) so the login
 * surface never renders for signed-in users.
 */
import { Navigate, useLocation } from 'react-router';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { env } from '@/lib/env';

import { LoginForm } from '../components/LoginForm';
import { useAuth } from '../hooks';

interface LocationState {
  from?: { pathname?: string };
}

export default function LoginPage(): React.ReactElement {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (isAuthenticated) {
    const fromPath = (location.state as LocationState | null)?.from?.pathname;
    return <Navigate to={fromPath ?? '/'} replace />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <span
            aria-hidden
            className="flex size-12 items-center justify-center rounded-2xl bg-primary text-2xl font-black tracking-tight text-primary-foreground shadow-sm"
          >
            0
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            <span className="text-primary">{env.APP_NAME ?? 'ZeroZero'}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Zero delays. Zero hassle. Hot meals at your door.
          </p>
        </div>

        <Card className="shadow-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>
              Sign in to order from your favourite restaurants.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

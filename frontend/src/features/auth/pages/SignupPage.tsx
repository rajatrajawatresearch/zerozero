/**
 * Signup route — mirrors the LoginPage layout (centered card + branding).
 * Signed-in users are redirected to `/`.
 */
import { Navigate } from 'react-router';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { env } from '@/lib/env';

import { SignupForm } from '../components/SignupForm';
import { useAuth } from '../hooks';

export default function SignupPage(): React.ReactElement {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    // AppShell already provides the single `<main>` landmark — avoid
    // duplicate `<main>` elements (axe: `landmark-no-duplicate-main`). Phase 5 A3.
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
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
            Create an account to start ordering in seconds.
          </p>
        </div>

        <Card className="shadow-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl">Create your account</CardTitle>
            <CardDescription>
              It only takes a minute — no credit card required.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignupForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

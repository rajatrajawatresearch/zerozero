import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

/**
 * 404 fallback page. Catches any unmatched route via the `*` path in
 * `src/features/routes.ts`.
 */
export default function NotFoundPage(): React.ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-md space-y-6 text-center">
        <p className="text-6xl font-bold tracking-tight text-primary">404</p>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Page not found</h1>
          <p className="text-muted-foreground">
            The page you were looking for doesn&apos;t exist or was moved.
          </p>
        </div>
        <Button asChild>
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </main>
  );
}

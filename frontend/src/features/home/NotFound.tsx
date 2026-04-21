import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Catch-all 404 page. Mounted inside AppShell so header + footer stay visible.
 */
export default function NotFound(): ReactElement {
  return (
    <section className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-6 py-20 text-center">
      <p className="text-7xl font-black tracking-tight text-primary">404</p>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Page not found
      </h1>
      <p className="text-sm text-muted-foreground">
        The page you were looking for doesn&apos;t exist, was moved, or is still being built.
      </p>
      <Button asChild className="gap-2">
        <Link to="/">
          <Home className="size-4" />
          Back home
        </Link>
      </Button>
    </section>
  );
}

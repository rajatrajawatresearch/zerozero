import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/components/layout/Logo';

/**
 * Low-ink bottom chrome. Lives below the main content on every page (except
 * focused flows that don't mount AppShell, e.g. full-screen login in Phase 3).
 */
export function Footer(): ReactElement {
  return (
    <footer className="mt-auto border-t border-border/60 bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Logo variant="sm" />
          <span className="text-xs">  2026 ZeroZero &middot; demo project</span>
        </div>
        <nav aria-label="Footer" className="flex items-center gap-5 text-xs">
          <Link to="/restaurants" className="hover:text-foreground">
            Restaurants
          </Link>
          <Link to="/about" className="hover:text-foreground">
            About
          </Link>
          <a
            href="https://github.com/"
            rel="noreferrer"
            target="_blank"
            className="hover:text-foreground"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}

export default Footer;

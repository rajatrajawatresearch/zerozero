import type { ReactElement } from 'react';
import { Outlet } from 'react-router';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { MobileNav } from '@/components/layout/MobileNav';
import { GlobalSearchPalette } from '@/features/search';

/**
 * Root shell rendered for every route. Provides the skip-to-main affordance,
 * sticky chrome, and a `<main>` landmark with a guaranteed minimum height so
 * skinny pages don't leave the footer mid-screen.
 *
 * The bottom `MobileNav` is sticky; we pad the main element on small screens
 * so its last element isn't occluded by the nav bar.
 */
export function AppShell(): ReactElement {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main"
        className={
          'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 ' +
          'focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-primary-foreground'
        }
      >
        Skip to main content
      </a>
      <Header />
      <main
        id="main"
        className="flex-1 pb-16 sm:pb-0"
      >
        <Outlet />
      </main>
      <Footer />
      <MobileNav />
      <GlobalSearchPalette />
    </div>
  );
}

export default AppShell;

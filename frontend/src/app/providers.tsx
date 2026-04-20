import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/features/theme';
import { queryClient } from './query-client';
import { ErrorBoundary } from './error-boundary';

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * Root provider stack. Order matters:
 *   QueryClient → Theme → ErrorBoundary → TooltipProvider → children
 *
 * - Query client must wrap everything so devtools + hooks work.
 * - Theme provider wraps the error boundary so the fallback UI picks up
 *   the correct OKLCH variables even when a crash happens mid-render.
 * - Error boundary catches everything rendered inside the app shell.
 * - TooltipProvider (Radix) is required once near the root for any
 *   `<Tooltip>` usages downstream.
 * - Toaster (sonner) lives *inside* TooltipProvider so toasts inherit
 *   the themed portal root.
 */
export function AppProviders({ children }: AppProvidersProps): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ErrorBoundary>
          <TooltipProvider delayDuration={150}>
            {children}
            <Toaster richColors closeButton position="top-right" />
          </TooltipProvider>
        </ErrorBoundary>
        <ReactQueryDevtools initialIsOpen={false} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

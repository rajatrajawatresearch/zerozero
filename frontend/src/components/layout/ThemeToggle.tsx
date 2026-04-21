import { useCallback, type ReactElement } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/features/theme';
import type { ThemeMode } from '@/features/theme';
import { cn } from '@/lib/utils';

const ORDER: ThemeMode[] = ['light', 'dark', 'system'];

const LABELS: Record<ThemeMode, string> = {
  light: 'Switch to dark mode',
  dark: 'Switch to system preference',
  system: 'Switch to light mode',
};

/**
 * Icon button that cycles light → dark → system on click.
 * Shows the icon of the currently-active mode so users see state + action affordance at once.
 */
export function ThemeToggle({ className }: { className?: string }): ReactElement {
  const { mode, setMode } = useTheme();

  const next = useCallback(() => {
    const idx = ORDER.indexOf(mode);
    const nextMode = ORDER[(idx + 1) % ORDER.length] ?? 'system';
    setMode(nextMode);
  }, [mode, setMode]);

  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={next}
      aria-label={LABELS[mode]}
      title={LABELS[mode]}
      className={cn('relative', className)}
    >
      <Icon className="size-4 transition-transform" />
    </Button>
  );
}

export default ThemeToggle;

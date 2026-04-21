/**
 * WCAG contrast chip — shows the live ratio + conformance level for a
 * foreground/background OKLCH pair. Colour of the chip itself signals the
 * state at a glance:
 *
 *   AAA          → green
 *   AA           → green
 *   AA Large     → amber
 *   Fail         → red
 *
 * Surfaces beside every color picker in the customizer sheet. No external
 * dependencies; we re-use the local shadcn `<Badge>`.
 */
import type { ReactElement } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useWcagContrast, type WcagLevel } from '../hooks';
import type { Oklch } from '@/features/theme';

interface ContrastBadgeProps {
  /** Foreground colour (text / icon). */
  fg: Oklch;
  /** Background colour (surface behind the fg). */
  bg: Oklch;
  /** Optional label prefix (e.g. "Primary"). */
  label?: string;
  className?: string;
}

const LEVEL_VARIANT: Record<WcagLevel, 'success' | 'warning' | 'destructive'> = {
  AAA: 'success',
  AA: 'success',
  'AA Large': 'warning',
  Fail: 'destructive',
};

export function ContrastBadge({ fg, bg, label, className }: ContrastBadgeProps): ReactElement {
  const { ratio, level } = useWcagContrast(fg, bg);
  const variant = LEVEL_VARIANT[level];

  return (
    <Badge
      variant={variant}
      className={cn('gap-1.5 font-mono', className)}
      aria-label={`${label ? label + ' ' : ''}WCAG contrast ratio ${ratio.toFixed(2)} to 1, ${level}`}
      title={`${ratio.toFixed(2)}:1 — ${level}`}
    >
      {label ? <span className="font-sans text-[10px] font-semibold uppercase opacity-80">{label}</span> : null}
      <span>{ratio.toFixed(2)}:1</span>
      <span className="font-sans text-[10px] font-semibold uppercase tracking-wide">{level}</span>
    </Badge>
  );
}

export default ContrastBadge;

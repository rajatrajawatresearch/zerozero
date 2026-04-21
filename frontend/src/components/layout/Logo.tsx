import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';

export interface LogoProps {
  /** Visual size variant — `sm` for header chrome, `lg` for hero/empty states. */
  variant?: 'sm' | 'lg';
  /** Pass-through className so callers can align or space the mark. */
  className?: string;
  /** Optional aria-label override; defaults to "ZeroZero home". */
  ariaLabel?: string;
}

/**
 * SVG wordmark for ZeroZero. Uses the `--primary` OKLCH CSS variable so the
 * mark re-themes automatically when the ThemeCustomizerSheet writes new values
 * onto the document root.
 *
 * Two visual sizes:
 *   sm — header (28px height, 1rem text)
 *   lg — hero  (48px height, 2rem text)
 */
export function Logo({ variant = 'sm', className, ariaLabel = 'ZeroZero' }: LogoProps): ReactElement {
  const isLarge = variant === 'lg';
  const height = isLarge ? 48 : 28;
  const radius = isLarge ? 14 : 8;
  const circleR = isLarge ? 18 : 10;
  const strokeW = isLarge ? 5 : 3;
  const textSize = isLarge ? 'text-2xl sm:text-3xl' : 'text-lg';

  return (
    <span
      className={cn('inline-flex items-center gap-2 font-bold tracking-tight text-foreground', textSize, className)}
      aria-label={ariaLabel}
    >
      <svg
        role="img"
        viewBox="0 0 64 48"
        height={height}
        aria-hidden="true"
        className="shrink-0"
      >
        {/* Two interlocking zeros rendered as rounded rectangles + circles for the brand mark. */}
        <rect
          x="2"
          y="4"
          width="28"
          height="40"
          rx={radius}
          fill="var(--primary)"
        />
        <circle cx="16" cy="24" r={circleR / 1.5} fill="var(--primary-foreground)" />
        <rect
          x="34"
          y="4"
          width="28"
          height="40"
          rx={radius}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={strokeW}
        />
        <circle
          cx="48"
          cy="24"
          r={circleR / 1.5}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={strokeW}
        />
      </svg>
      <span className="leading-none">
        <span className="text-primary">Zero</span>
        <span>Zero</span>
      </span>
    </span>
  );
}

export default Logo;

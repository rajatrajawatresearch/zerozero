/**
 * OKLCH-native slider picker — three `<input type="range">` controls for
 * lightness / chroma / hue, plus a live swatch.
 *
 * Phase 2 used a hex colour picker (`react-colorful`) with an OKLCH bridge.
 * Hex sliders are great for RGB-familiar users but lossy: they clamp to
 * displayable sRGB and erase perceptual information. Since our theme engine
 * speaks OKLCH natively and the user can *see* the swatch, exposing L / C / H
 * directly gives them per-axis control with zero conversion error.
 *
 * Ranges:
 *   L (lightness) → 0.00 – 1.00, step 0.01
 *   C (chroma)    → 0.00 – 0.37, step 0.005   (≈ practical maximum)
 *   H (hue)       → 0   – 359,  step 1
 */
import { useCallback, type ChangeEvent, type ReactElement } from 'react';
import { oklchToString, type Oklch } from '@/features/theme';
import { cn } from '@/lib/utils';

interface OklchPickerProps {
  value: Oklch;
  onChange: (next: Oklch) => void;
  /** Screen-reader label e.g. "Primary color". */
  label?: string;
  className?: string;
}

const MAX_CHROMA = 0.37;

interface SliderRowProps {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Human-readable value shown on the right. */
  display: string;
  /** Tailwind background for the slider track. */
  trackBackground: string;
  onChange: (n: number) => void;
}

function SliderRow({
  id,
  label,
  min,
  max,
  step,
  value,
  display,
  trackBackground,
  onChange,
}: SliderRowProps): ReactElement {
  const handle = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value)),
    [onChange],
  );
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="font-medium text-muted-foreground">
          {label}
        </label>
        <code className="font-mono text-[11px] tabular-nums text-foreground/80">{display}</code>
      </div>
      <div
        className="relative h-2 rounded-full ring-1 ring-border"
        style={{ background: trackBackground }}
      >
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handle}
          aria-label={label}
          className={cn(
            'absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent',
            '[&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4',
            '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-background',
            '[&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-foreground',
            '[&::-webkit-slider-thumb]:shadow-sm',
            '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full',
            '[&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-foreground',
          )}
        />
      </div>
    </div>
  );
}

/**
 * OKLCH picker — three sliders + swatch. Fires `onChange` with a fresh
 * `{ l, c, h }` object on every axis change. Stateless by design; the
 * owning component keeps the source of truth.
 */
export function OklchPicker({ value, onChange, label, className }: OklchPickerProps): ReactElement {
  const setL = useCallback((l: number) => onChange({ ...value, l }), [onChange, value]);
  const setC = useCallback((c: number) => onChange({ ...value, c }), [onChange, value]);
  const setH = useCallback((h: number) => onChange({ ...value, h }), [onChange, value]);

  // Gradient backgrounds hint at the axis movement. Chroma + hue gradients
  // use the current other two channels so the cue stays accurate.
  const lightnessGradient = `linear-gradient(to right, ${oklchToString({ l: 0, c: value.c, h: value.h })}, ${oklchToString({ l: 1, c: value.c, h: value.h })})`;
  const chromaGradient = `linear-gradient(to right, ${oklchToString({ l: value.l, c: 0, h: value.h })}, ${oklchToString({ l: value.l, c: MAX_CHROMA, h: value.h })})`;
  const hueGradient = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => oklchToString({ l: value.l, c: value.c, h })).join(', ')})`;

  return (
    <div className={cn('flex w-full flex-col items-stretch gap-4', className)} aria-label={label}>
      <div
        aria-hidden
        className="grid h-24 w-full place-items-center rounded-md ring-1 ring-border"
        style={{ background: oklchToString(value) }}
      >
        <code className="rounded bg-background/80 px-2 py-0.5 font-mono text-[11px] text-foreground/90 shadow-sm">
          {oklchToString(value)}
        </code>
      </div>

      <SliderRow
        id={`oklch-l-${label ?? 'value'}`}
        label="Lightness"
        min={0}
        max={1}
        step={0.01}
        value={value.l}
        display={value.l.toFixed(2)}
        trackBackground={lightnessGradient}
        onChange={setL}
      />
      <SliderRow
        id={`oklch-c-${label ?? 'value'}`}
        label="Chroma"
        min={0}
        max={MAX_CHROMA}
        step={0.005}
        value={value.c}
        display={value.c.toFixed(3)}
        trackBackground={chromaGradient}
        onChange={setC}
      />
      <SliderRow
        id={`oklch-h-${label ?? 'value'}`}
        label="Hue"
        min={0}
        max={359}
        step={1}
        value={value.h}
        display={`${Math.round(value.h)}°`}
        trackBackground={hueGradient}
        onChange={setH}
      />
    </div>
  );
}

export default OklchPicker;

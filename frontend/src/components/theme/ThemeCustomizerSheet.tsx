import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { HexColorPicker } from 'react-colorful';
import { Paintbrush, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  PRESETS,
  oklchToString,
  useTheme,
  type Oklch,
  type ThemeRadius,
} from '@/features/theme';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*                             OKLCH <-> HEX bridge                           */
/* -------------------------------------------------------------------------- */
/**
 * `react-colorful` speaks hex RGB. Our theme engine speaks OKLCH. We bridge
 * via `color(from oklch srgb ...)` in a canvas and vice-versa. The approach:
 *
 *   OKLCH -> hex: render the oklch() string as a swatch in a tiny offscreen
 *   canvas, read back the pixel — cheap, accurate enough for a picker.
 *
 *   hex -> OKLCH: we convert hex to sRGB, linearise, transform to OKLab,
 *   then OKLab to OKLCH. The math is small; worth it to avoid a full
 *   culori/colorjs.io dependency for Phase 2.
 */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const int = Number.parseInt(full, 16);
  return {
    r: ((int >> 16) & 0xff) / 255,
    g: ((int >> 8) & 0xff) / 255,
    b: (int & 0xff) / 255,
  };
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** sRGB (linear) -> OKLab -> OKLCH. Source: https://bottosson.github.io/posts/oklab/ */
function rgbToOklch({ r, g, b }: { r: number; g: number; b: number }): Oklch {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.hypot(a, bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { l: L, c: C, h: H };
}

/** OKLCH -> OKLab -> linear RGB -> sRGB -> hex. */
function oklchToHex(color: Oklch): string {
  const h = (color.h * Math.PI) / 180;
  const a = Math.cos(h) * color.c;
  const bb = Math.sin(h) * color.c;

  const l_ = color.l + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = color.l - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = color.l - 0.0894841775 * a - 1.291485548 * bb;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const r = Math.round(Math.max(0, Math.min(1, linearToSrgb(lr))) * 255);
  const g = Math.round(Math.max(0, Math.min(1, linearToSrgb(lg))) * 255);
  const b = Math.round(Math.max(0, Math.min(1, linearToSrgb(lb))) * 255);

  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/* -------------------------------------------------------------------------- */
/*                                   Component                                */
/* -------------------------------------------------------------------------- */

interface SwatchGridProps {
  onSelect: (id: string) => void;
}

function PresetSwatchGrid({ onSelect }: SwatchGridProps): ReactElement {
  return (
    <div className="grid grid-cols-5 gap-2">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onSelect(preset.id)}
          className={cn(
            'group flex flex-col items-center gap-1.5 rounded-md border border-transparent p-2 text-xs',
            'transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label={`Apply ${preset.name} preset`}
        >
          <span
            aria-hidden
            className="relative grid size-10 place-items-center rounded-full ring-1 ring-border"
            style={{ background: oklchToString(preset.primary) }}
          >
            <span
              className="size-4 rounded-full ring-2 ring-background"
              style={{ background: oklchToString(preset.accent) }}
            />
          </span>
          <span className="line-clamp-1 font-medium text-foreground/80 group-hover:text-foreground">
            {preset.name}
          </span>
        </button>
      ))}
    </div>
  );
}

const RADII: ThemeRadius[] = ['sm', 'md', 'lg'];

/**
 * Paint-bucket trigger + right-side Sheet that lets the user:
 *   - click a preset swatch
 *   - adjust primary / accent via hex picker (we bridge to OKLCH live)
 *   - choose radius via Tabs
 *   - reset to defaults
 *
 * Changes flow through `useTheme()` — ThemeProvider writes OKLCH values
 * into the document root so the entire app rethemes in real time.
 */
export function ThemeCustomizerSheet(): ReactElement {
  const { primary, accent, radius, setPrimary, setAccent, applyPreset, setRadius, resetToDefault } =
    useTheme();
  const [tab, setTab] = useState<'primary' | 'accent'>('primary');

  const primaryHex = useMemo(() => oklchToHex(primary), [primary]);
  const accentHex = useMemo(() => oklchToHex(accent), [accent]);

  const handlePrimary = useCallback(
    (hex: string) => {
      setPrimary(rgbToOklch(hexToRgb(hex)));
    },
    [setPrimary],
  );

  const handleAccent = useCallback(
    (hex: string) => {
      setAccent(rgbToOklch(hexToRgb(hex)));
    },
    [setAccent],
  );

  const handleReset = useCallback(() => {
    resetToDefault();
  }, [resetToDefault]);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open theme customizer"
          title="Customize theme"
        >
          <Paintbrush className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-5 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Paintbrush className="size-4 text-primary" />
            Theme customizer
          </SheetTitle>
          <SheetDescription>
            Pick a preset or roll your own. Changes are live and persisted to this device.
          </SheetDescription>
        </SheetHeader>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Presets
          </h3>
          <PresetSwatchGrid onSelect={applyPreset} />
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Colors
            </h3>
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'primary' | 'accent')}>
              <TabsList>
                <TabsTrigger value="primary">Primary</TabsTrigger>
                <TabsTrigger value="accent">Accent</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {tab === 'primary' ? (
            <div className="flex flex-col items-center gap-3">
              <HexColorPicker
                color={primaryHex}
                onChange={handlePrimary}
                style={{ width: '100%', height: 180 }}
              />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="size-5 rounded-full ring-1 ring-border"
                  style={{ background: oklchToString(primary) }}
                />
                <code className="font-mono">{primaryHex.toUpperCase()}</code>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <HexColorPicker
                color={accentHex}
                onChange={handleAccent}
                style={{ width: '100%', height: 180 }}
              />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="size-5 rounded-full ring-1 ring-border"
                  style={{ background: oklchToString(accent) }}
                />
                <code className="font-mono">{accentHex.toUpperCase()}</code>
              </div>
            </div>
          )}
        </section>

        <Separator />

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Radius
          </h3>
          <Tabs value={radius} onValueChange={(v) => setRadius(v as ThemeRadius)}>
            <TabsList className="w-full">
              {RADII.map((r) => (
                <TabsTrigger key={r} value={r} className="flex-1 capitalize">
                  {r}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </section>

        <SheetFooter className="mt-auto flex-row gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={handleReset} className="gap-2">
            <RotateCcw className="size-4" />
            Reset
          </Button>
          <SheetClose asChild>
            <Button type="button">Done</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default ThemeCustomizerSheet;

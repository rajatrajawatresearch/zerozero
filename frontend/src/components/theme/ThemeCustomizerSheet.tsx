import { useCallback, useState, type ReactElement } from 'react';
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
  contrastForeground,
  oklchToString,
  useTheme,
  type ThemeRadius,
} from '@/features/theme';
import {
  ContrastBadge,
  CustomPresetManager,
  ExportImportPanel,
  OklchPicker,
  useKeyboardShortcut,
} from '@/features/theme-customizer';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*                                  Subviews                                  */
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

/* -------------------------------------------------------------------------- */
/*                                  Component                                 */
/* -------------------------------------------------------------------------- */

/**
 * Paint-bucket trigger + right-side Sheet.
 *
 * Phase 2 (Agent 10) composition:
 *   - preset swatch grid
 *   - primary / accent picker (originally HexColorPicker)
 *   - radius tabs
 *   - reset button
 *
 * Phase 4 (Agent 9) extensions — composed in from `features/theme-customizer`:
 *   - `OklchPicker` replaces `HexColorPicker` (lossless OKLCH control)
 *   - `ContrastBadge` renders WCAG ratio next to each picker
 *   - `CustomPresetManager` — localStorage-backed saved themes
 *   - `ExportImportPanel` — JSON export / import via clipboard + textarea
 *   - Global `shift+t` keyboard shortcut opens the sheet (controlled state)
 *
 * Changes flow through `useTheme()` — ThemeProvider writes OKLCH values
 * into the document root so the entire app rethemes in real time.
 */
export function ThemeCustomizerSheet(): ReactElement {
  const { primary, accent, radius, setPrimary, setAccent, applyPreset, setRadius, resetToDefault } =
    useTheme();
  const [tab, setTab] = useState<'primary' | 'accent'>('primary');
  const [open, setOpen] = useState(false);

  // Phase 4: `shift+t` toggles the customizer from anywhere in the app.
  // Ignored when focus is in an input/textarea/contenteditable.
  useKeyboardShortcut('shift+t', () => setOpen((prev) => !prev));

  const handleReset = useCallback(() => {
    resetToDefault();
  }, [resetToDefault]);

  // Foreground that ThemeProvider will actually use — reuse the shared
  // helper so the badge is always consistent with what renders on screen.
  const primaryFg = contrastForeground(primary);
  const accentFg = contrastForeground(accent);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open theme customizer"
          title="Customize theme (Shift+T)"
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
            Pick a preset or roll your own. Changes are live and persisted to this device. Press
            <kbd className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px]">Shift</kbd>+
            <kbd className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px]">T</kbd>
            to toggle.
          </SheetDescription>
        </SheetHeader>

        {/* Presets — Phase 2 */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Presets
          </h3>
          <PresetSwatchGrid onSelect={applyPreset} />
        </section>

        <Separator />

        {/* Colors — Phase 2 structure preserved; picker swapped to OklchPicker
            and ContrastBadge layered on top. */}
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
            <div className="space-y-3">
              <OklchPicker value={primary} onChange={setPrimary} label="Primary color" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Foreground vs. primary surface
                </span>
                <ContrastBadge fg={primaryFg} bg={primary} label="Primary" />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <OklchPicker value={accent} onChange={setAccent} label="Accent color" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Foreground vs. accent surface
                </span>
                <ContrastBadge fg={accentFg} bg={accent} label="Accent" />
              </div>
            </div>
          )}
        </section>

        <Separator />

        {/* Radius — Phase 2 */}
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

        <Separator />

        {/* Custom Presets — Phase 4 (local only) */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Custom presets
          </h3>
          <CustomPresetManager />
        </section>

        <Separator />

        {/* Export / Import — Phase 4 */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Export &amp; import
          </h3>
          <ExportImportPanel />
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

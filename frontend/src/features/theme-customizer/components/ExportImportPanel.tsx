/**
 * Export / import the current theme as JSON.
 *
 * Export  → writes a compact `{mode, primary, accent, radius}` object to the
 *           clipboard. `primary` / `accent` are OKLCH strings so the payload
 *           survives round-tripping through `oklchFromString` on import.
 *
 * Import  → user pastes JSON, we validate shape, and apply via `useTheme()`.
 *           Malformed input triggers a sonner toast; nothing is mutated.
 *
 * Keep this panel dumb — any persistence is already handled by
 * `ThemeProvider`'s debounced localStorage write.
 */
import { useCallback, useState, type ReactElement } from 'react';
import { Check, ClipboardCopy, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  oklchFromString,
  oklchToString,
  useTheme,
  type Oklch,
  type ThemeMode,
  type ThemeRadius,
} from '@/features/theme';
import { cn } from '@/lib/utils';

interface ExportedTheme {
  mode: ThemeMode;
  primary: string;
  accent: string;
  radius: ThemeRadius;
}

function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'system';
}

function isThemeRadius(v: unknown): v is ThemeRadius {
  return v === 'sm' || v === 'md' || v === 'lg';
}

function isValidOklch(c: Oklch): boolean {
  return (
    Number.isFinite(c.l) &&
    Number.isFinite(c.c) &&
    Number.isFinite(c.h) &&
    !(c.l === 0 && c.c === 0 && c.h === 0) // oklchFromString's defensive fallback
  );
}

function buildExport(primary: Oklch, accent: Oklch, mode: ThemeMode, radius: ThemeRadius): string {
  const payload: ExportedTheme = {
    mode,
    radius,
    primary: oklchToString(primary),
    accent: oklchToString(accent),
  };
  return JSON.stringify(payload, null, 2);
}

export function ExportImportPanel(): ReactElement {
  const { mode, primary, accent, radius, setMode, setPrimary, setAccent, setRadius } = useTheme();
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const json = buildExport(primary, accent, mode, radius);
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      toast.success('Theme copied to clipboard');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Clipboard unavailable — select the text manually');
    }
  }, [primary, accent, mode, radius]);

  const handleImport = useCallback(() => {
    const raw = draft.trim();
    if (!raw) {
      toast.error('Paste a theme JSON first');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      toast.error('Invalid JSON — check braces and quoting');
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      toast.error('Theme JSON must be an object');
      return;
    }
    const p = parsed as Partial<ExportedTheme>;
    if (!isThemeMode(p.mode) || !isThemeRadius(p.radius) || typeof p.primary !== 'string' || typeof p.accent !== 'string') {
      toast.error('Theme JSON missing mode / primary / accent / radius');
      return;
    }
    const primaryNext = oklchFromString(p.primary);
    const accentNext = oklchFromString(p.accent);
    if (!isValidOklch(primaryNext) || !isValidOklch(accentNext)) {
      toast.error('Could not parse OKLCH colors');
      return;
    }
    setMode(p.mode);
    setRadius(p.radius);
    setPrimary(primaryNext);
    setAccent(accentNext);
    setDraft('');
    toast.success('Theme imported');
  }, [draft, setMode, setRadius, setPrimary, setAccent]);

  const preview = buildExport(primary, accent, mode, radius);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Export</span>
          <Button type="button" size="sm" variant="outline" onClick={handleCopy} className="gap-1.5">
            {copied ? <Check className="size-3.5" /> : <ClipboardCopy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy JSON'}
          </Button>
        </div>
        <pre
          className={cn(
            'max-h-28 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]',
            'leading-relaxed text-foreground/80',
          )}
        >
          {preview}
        </pre>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="theme-import-textarea" className="text-xs font-medium text-muted-foreground">
          Import
        </label>
        <textarea
          id="theme-import-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder='Paste theme JSON here, e.g. {"mode":"light","primary":"oklch(...)","accent":"oklch(...)","radius":"md"}'
          className={cn(
            'min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs',
            'placeholder:text-muted-foreground/60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label="Theme JSON import"
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={handleImport} className="gap-1.5">
            <Upload className="size-3.5" />
            Apply imported theme
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ExportImportPanel;

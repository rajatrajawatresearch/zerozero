/**
 * Local custom-preset manager.
 *
 * Saves named themes (current primary + accent + radius + mode) to
 * `localStorage` under `zz:theme:custom-presets`. Phase 4 is **local only** —
 * no backend `POST /users/me/theme-presets` call yet (that arrives post-Phase
 * 4 per `docs/PHASE4_CONTRACTS.md`). The UI shows an info hint about this.
 *
 * Features:
 *   - name input + save-current button
 *   - grid of swatches with apply + delete per entry
 *   - empty-state copy so the section never looks broken
 *   - toast feedback on every action
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Info, Save, Trash2 } from 'lucide-react';
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

const STORAGE_KEY = 'zz:theme:custom-presets';

interface StoredPreset {
  id: string;
  name: string;
  primary: string;
  accent: string;
  radius: ThemeRadius;
  mode: ThemeMode;
  /** ISO timestamp for future sort/filter. */
  createdAt: string;
}

interface CustomPreset {
  id: string;
  name: string;
  primary: Oklch;
  accent: Oklch;
  radius: ThemeRadius;
  mode: ThemeMode;
  createdAt: string;
}

function readPresets(): CustomPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is StoredPreset => {
        if (!p || typeof p !== 'object') return false;
        const o = p as Record<string, unknown>;
        return (
          typeof o.id === 'string' &&
          typeof o.name === 'string' &&
          typeof o.primary === 'string' &&
          typeof o.accent === 'string'
        );
      })
      .map((p) => ({
        id: p.id,
        name: p.name,
        primary: oklchFromString(p.primary),
        accent: oklchFromString(p.accent),
        radius: (p.radius ?? 'md') as ThemeRadius,
        mode: (p.mode ?? 'system') as ThemeMode,
        createdAt: p.createdAt ?? new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function writePresets(list: CustomPreset[]): void {
  if (typeof window === 'undefined') return;
  const payload: StoredPreset[] = list.map((p) => ({
    id: p.id,
    name: p.name,
    primary: oklchToString(p.primary),
    accent: oklchToString(p.accent),
    radius: p.radius,
    mode: p.mode,
    createdAt: p.createdAt,
  }));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // quota / private-mode — surface once, don't crash.
    toast.error('Could not save preset — storage unavailable');
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function CustomPresetManager(): ReactElement {
  const { mode, primary, accent, radius, setMode, setPrimary, setAccent, setRadius } = useTheme();

  const [presets, setPresets] = useState<CustomPreset[]>(() => readPresets());
  const [name, setName] = useState('');

  // Sync across tabs — cheap, no subscription leak since effect is mount-scoped.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPresets(readPresets());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((next: CustomPreset[]) => {
    setPresets(next);
    writePresets(next);
  }, []);

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Give your preset a name first');
      return;
    }
    if (presets.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('A preset with that name already exists');
      return;
    }
    const next: CustomPreset = {
      id: randomId(),
      name: trimmed,
      primary,
      accent,
      radius,
      mode,
      createdAt: new Date().toISOString(),
    };
    persist([next, ...presets]);
    setName('');
    toast.success(`Saved "${trimmed}"`);
  }, [name, presets, primary, accent, radius, mode, persist]);

  const handleApply = useCallback(
    (p: CustomPreset) => {
      setPrimary(p.primary);
      setAccent(p.accent);
      setRadius(p.radius);
      setMode(p.mode);
      toast.success(`Applied "${p.name}"`);
    },
    [setPrimary, setAccent, setRadius, setMode],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const removed = presets.find((p) => p.id === id);
      persist(presets.filter((p) => p.id !== id));
      if (removed) toast.success(`Removed "${removed.name}"`);
    },
    [presets, persist],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-2 text-[11px] text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Custom presets live on this device only. Cloud sync arrives after Phase 4 — see
          <code className="mx-1 font-mono">/users/me/theme-presets</code>.
        </span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Diwali Warm"
          className={cn(
            'h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm',
            'placeholder:text-muted-foreground/60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label="New preset name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSave();
            }
          }}
        />
        <Button type="button" size="sm" onClick={handleSave} className="gap-1.5">
          <Save className="size-3.5" />
          Save
        </Button>
      </div>

      {presets.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          No custom presets yet. Tweak colors above then click <strong>Save</strong>.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {presets.map((p) => (
            <li
              key={p.id}
              className={cn(
                'group relative flex items-center gap-2 rounded-md border bg-card p-2 text-xs',
                'transition-colors hover:border-primary/40',
              )}
            >
              <button
                type="button"
                onClick={() => handleApply(p)}
                className="flex flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                aria-label={`Apply preset ${p.name}`}
              >
                <span
                  aria-hidden
                  className="relative grid size-8 place-items-center rounded-full ring-1 ring-border"
                  style={{ background: oklchToString(p.primary) }}
                >
                  <span
                    className="size-3 rounded-full ring-2 ring-background"
                    style={{ background: oklchToString(p.accent) }}
                  />
                </span>
                <span className="line-clamp-1 flex-1 font-medium text-foreground/90">{p.name}</span>
              </button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => handleDelete(p.id)}
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${p.name}`}
                title="Delete preset"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CustomPresetManager;

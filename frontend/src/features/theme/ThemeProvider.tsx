import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  contrastForeground,
  oklchFromString,
  oklchToString,
  type Oklch,
} from './colors';
import { DEFAULT_PRESET, PRESETS } from './presets';
import type {
  ThemeActions,
  ThemeContextValue,
  ThemeMode,
  ThemeRadius,
  ThemeState,
} from './types';

const STORAGE_KEY = 'zz:theme';
const PERSIST_DEBOUNCE_MS = 300;

/** Radius scale in rem, applied as CSS vars on <html>. */
const RADIUS_SCALE: Record<ThemeRadius, { sm: string; md: string; lg: string; xl: string }> = {
  sm: { sm: '0.125rem', md: '0.25rem', lg: '0.375rem', xl: '0.5rem' },
  md: { sm: '0.25rem', md: '0.5rem', lg: '0.75rem', xl: '1rem' },
  lg: { sm: '0.375rem', md: '0.75rem', lg: '1rem', xl: '1.5rem' },
};

const DEFAULT_STATE: ThemeState = {
  mode: 'system',
  primary: DEFAULT_PRESET.primary,
  accent: DEFAULT_PRESET.accent,
  radius: 'md',
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

interface StoredTheme {
  mode?: ThemeMode;
  primary?: string;
  accent?: string;
  radius?: ThemeRadius;
}

function readStoredTheme(): Partial<ThemeState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredTheme;
    const next: Partial<ThemeState> = {};
    if (parsed.mode === 'light' || parsed.mode === 'dark' || parsed.mode === 'system') {
      next.mode = parsed.mode;
    }
    if (parsed.radius === 'sm' || parsed.radius === 'md' || parsed.radius === 'lg') {
      next.radius = parsed.radius;
    }
    if (parsed.primary) next.primary = oklchFromString(parsed.primary);
    if (parsed.accent) next.accent = oklchFromString(parsed.accent);
    return next;
  } catch {
    return {};
  }
}

function writeStoredTheme(state: ThemeState): void {
  if (typeof window === 'undefined') return;
  const payload: StoredTheme = {
    mode: state.mode,
    primary: oklchToString(state.primary),
    accent: oklchToString(state.accent),
    radius: state.radius,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // quota errors etc. — non-fatal
  }
}

// ---------------------------------------------------------------------------
// DOM application
// ---------------------------------------------------------------------------

function applyColorsToRoot(primary: Oklch, accent: Oklch): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const primaryFg = contrastForeground(primary);
  const accentFg = contrastForeground(accent);

  root.style.setProperty('--primary', oklchToString(primary));
  root.style.setProperty('--primary-foreground', oklchToString(primaryFg));
  root.style.setProperty('--accent', oklchToString(accent));
  root.style.setProperty('--accent-foreground', oklchToString(accentFg));

  // Sidebar tokens track primary so customization propagates everywhere.
  root.style.setProperty('--sidebar-primary', oklchToString(primary));
  root.style.setProperty('--sidebar-primary-foreground', oklchToString(primaryFg));
}

function applyRadiusToRoot(radius: ThemeRadius): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const scale = RADIUS_SCALE[radius];
  root.style.setProperty('--radius-sm', scale.sm);
  root.style.setProperty('--radius-md', scale.md);
  root.style.setProperty('--radius-lg', scale.lg);
  root.style.setProperty('--radius-xl', scale.xl);
  root.style.setProperty('--radius', scale.md);
}

function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyModeToRoot(mode: ThemeMode): boolean {
  if (typeof document === 'undefined') return false;
  const isDark = resolveIsDark(mode);
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';
  root.dataset.theme = isDark ? 'dark' : 'light';
  return isDark;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ThemeProviderProps {
  children: ReactNode;
  /** Optional initial state (takes precedence over localStorage on mount). */
  initialState?: Partial<ThemeState>;
}

export function ThemeProvider({ children, initialState }: ThemeProviderProps) {
  const [state, setState] = useState<ThemeState>(() => {
    const stored = readStoredTheme();
    return {
      ...DEFAULT_STATE,
      ...stored,
      ...initialState,
    };
  });

  const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(state.mode));
  const persistTimer = useRef<number | null>(null);

  // Apply colors whenever brand tokens change.
  useEffect(() => {
    applyColorsToRoot(state.primary, state.accent);
  }, [state.primary, state.accent]);

  // Apply radius.
  useEffect(() => {
    applyRadiusToRoot(state.radius);
  }, [state.radius]);

  // Apply mode + listen to system preference when mode === 'system'.
  useEffect(() => {
    const nextIsDark = applyModeToRoot(state.mode);
    setIsDark(nextIsDark);
    if (state.mode !== 'system' || typeof window === 'undefined') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = applyModeToRoot('system');
      setIsDark(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [state.mode]);

  // Debounced persist.
  useEffect(() => {
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(() => {
      writeStoredTheme(state);
      persistTimer.current = null;
    }, PERSIST_DEBOUNCE_MS);

    return () => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
    };
  }, [state]);

  // Actions
  const setMode = useCallback<ThemeActions['setMode']>((mode) => {
    setState((prev) => ({ ...prev, mode }));
  }, []);
  const setPrimary = useCallback<ThemeActions['setPrimary']>((primary) => {
    setState((prev) => ({ ...prev, primary }));
  }, []);
  const setAccent = useCallback<ThemeActions['setAccent']>((accent) => {
    setState((prev) => ({ ...prev, accent }));
  }, []);
  const setRadius = useCallback<ThemeActions['setRadius']>((radius) => {
    setState((prev) => ({ ...prev, radius }));
  }, []);
  const applyPreset = useCallback<ThemeActions['applyPreset']>((presetId) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setState((prev) => ({ ...prev, primary: preset.primary, accent: preset.accent }));
  }, []);
  const resetToDefault = useCallback<ThemeActions['resetToDefault']>(() => {
    setState(DEFAULT_STATE);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...state,
      isDark,
      setMode,
      setPrimary,
      setAccent,
      setRadius,
      applyPreset,
      resetToDefault,
    }),
    [state, isDark, setMode, setPrimary, setAccent, setRadius, applyPreset, resetToDefault],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

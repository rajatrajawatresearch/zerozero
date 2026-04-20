import type { Oklch } from './colors';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeRadius = 'sm' | 'md' | 'lg';

export interface ThemePreset {
  id: string;
  name: string;
  primary: Oklch;
  accent: Oklch;
}

export interface ThemeState {
  mode: ThemeMode;
  primary: Oklch;
  accent: Oklch;
  radius: ThemeRadius;
}

export interface ThemeActions {
  setMode: (mode: ThemeMode) => void;
  setPrimary: (color: Oklch) => void;
  setAccent: (color: Oklch) => void;
  setRadius: (radius: ThemeRadius) => void;
  applyPreset: (presetId: string) => void;
  resetToDefault: () => void;
}

export type ThemeContextValue = ThemeState & ThemeActions & {
  /** Whether the active (resolved) mode is dark. Useful for components that
   *  cannot rely on CSS `.dark` selectors (e.g. third-party widgets). */
  isDark: boolean;
};

export type { Oklch };

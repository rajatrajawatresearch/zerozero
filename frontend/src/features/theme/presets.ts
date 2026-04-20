import type { ThemePreset } from './types';

/**
 * Built-in theme presets. Primary is the brand color (buttons, links, CTA);
 * accent is a secondary hue used for badges, highlights, hover chrome.
 *
 * Keep this list curated — the customizer grid assumes ≤ 6 tiles.
 */
export const PRESETS: ThemePreset[] = [
  {
    id: 'classic-red',
    name: 'Classic Red',
    primary: { l: 0.58, c: 0.22, h: 25 },
    accent: { l: 0.75, c: 0.15, h: 70 },
  },
  {
    id: 'mint',
    name: 'Mint',
    primary: { l: 0.72, c: 0.13, h: 160 },
    accent: { l: 0.8, c: 0.1, h: 210 },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    primary: { l: 0.65, c: 0.2, h: 50 },
    accent: { l: 0.7, c: 0.18, h: 340 },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    primary: { l: 0.55, c: 0.18, h: 265 },
    accent: { l: 0.7, c: 0.15, h: 190 },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    primary: { l: 0.6, c: 0.16, h: 230 },
    accent: { l: 0.75, c: 0.12, h: 180 },
  },
];

export const DEFAULT_PRESET_ID = 'classic-red';

/** First preset is the on-boot default. */
export const DEFAULT_PRESET: ThemePreset =
  PRESETS.find((p) => p.id === DEFAULT_PRESET_ID) ?? (PRESETS[0] as ThemePreset);

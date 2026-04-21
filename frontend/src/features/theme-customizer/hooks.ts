/**
 * Theme-customizer hooks.
 *
 * Two independent utilities:
 *   - `useKeyboardShortcut(combo, onFire)` — registers a `keydown` listener on
 *     `window` while mounted. `combo` is a lower-case string such as
 *     `"shift+t"` or `"ctrl+k"`. We parse it into a predicate once and diff
 *     against each event; no libraries required.
 *
 *   - `useWcagContrast(fg, bg)` — returns the WCAG 2.1 relative-luminance
 *     contrast ratio + its conformance level. Both inputs are in OKLCH; we
 *     convert through OKLab → linear RGB → luminance. Good enough for a
 *     live "AA / AAA / Fail" badge next to the picker; precise to ~0.05.
 *
 * Neither hook touches the theme engine itself — it only reads. That keeps
 * Phase 1 Agent 9's `features/theme/*` territory untouched.
 */
import { useEffect, useMemo } from 'react';
import type { Oklch } from '@/features/theme';

/* -------------------------------------------------------------------------- */
/*                             useKeyboardShortcut                            */
/* -------------------------------------------------------------------------- */

type ParsedCombo = {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
};

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  const parsed: ParsedCombo = {
    key: '',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control') parsed.ctrl = true;
    else if (p === 'alt' || p === 'option') parsed.alt = true;
    else if (p === 'shift') parsed.shift = true;
    else if (p === 'meta' || p === 'cmd' || p === 'command') parsed.meta = true;
    else parsed.key = p;
  }
  return parsed;
}

function shouldIgnoreTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Register a global keyboard-shortcut listener on `window` while the calling
 * component is mounted.
 *
 * Typing into an input / textarea / contenteditable is ignored so the
 * shortcut does not hijack normal form input.
 */
export function useKeyboardShortcut(combo: string, onFire: () => void): void {
  const parsed = useMemo(() => parseCombo(combo), [combo]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: KeyboardEvent) => {
      if (shouldIgnoreTarget(e.target)) return;
      if (e.key.toLowerCase() !== parsed.key) return;
      if (e.ctrlKey !== parsed.ctrl) return;
      if (e.altKey !== parsed.alt) return;
      if (e.shiftKey !== parsed.shift) return;
      if (e.metaKey !== parsed.meta) return;
      e.preventDefault();
      onFire();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [parsed, onFire]);
}

/* -------------------------------------------------------------------------- */
/*                               useWcagContrast                              */
/* -------------------------------------------------------------------------- */

export type WcagLevel = 'AAA' | 'AA' | 'AA Large' | 'Fail';

export interface WcagContrastResult {
  ratio: number;
  level: WcagLevel;
}

/** OKLCH → linear sRGB (float channels, may exceed [0,1] in edge cases). */
function oklchToLinearRgb(color: Oklch): { r: number; g: number; b: number } {
  const hr = (color.h * Math.PI) / 180;
  const a = Math.cos(hr) * color.c;
  const b = Math.sin(hr) * color.c;

  const l_ = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = color.l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;

  return {
    r: 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    b: -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  };
}

/** Per WCAG 2.1: relative luminance of a linear-RGB triplet. */
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

function gradeContrast(ratio: number): WcagLevel {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Fail';
}

/**
 * Return the WCAG contrast ratio + level for `fg` on `bg`. Both in OKLCH.
 * Ratio is `(Llighter + 0.05) / (Ldarker + 0.05)`, range 1–21.
 */
export function useWcagContrast(fg: Oklch, bg: Oklch): WcagContrastResult {
  return useMemo(() => {
    const lFg = relativeLuminance(oklchToLinearRgb(fg));
    const lBg = relativeLuminance(oklchToLinearRgb(bg));
    const lighter = Math.max(lFg, lBg);
    const darker = Math.min(lFg, lBg);
    const ratio = (lighter + 0.05) / (darker + 0.05);
    const rounded = Math.round(ratio * 100) / 100;
    return { ratio: rounded, level: gradeContrast(rounded) };
  }, [fg, bg]);
}

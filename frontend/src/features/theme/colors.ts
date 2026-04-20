/**
 * OKLCH color utilities — lightweight, no external deps.
 *
 * OKLCH represents a color as { l, c, h }:
 *   l — lightness  [0, 1]
 *   c — chroma     [0, ~0.4] (unbounded in spec; practical max ~0.37)
 *   h — hue        [0, 360) degrees
 */

export type Oklch = { l: number; c: number; h: number };

/** Clamp utility (not exported — internal). */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Normalize hue into [0, 360). */
function normalizeHue(h: number): number {
  const mod = h % 360;
  return mod < 0 ? mod + 360 : mod;
}

/** Round to N decimals for compact CSS output. */
function round(v: number, decimals = 4): number {
  const k = 10 ** decimals;
  return Math.round(v * k) / k;
}

/**
 * Render an Oklch color as a CSS `oklch(...)` string.
 * @example oklchToString({ l: 0.58, c: 0.22, h: 25 }) → "oklch(0.58 0.22 25)"
 */
export function oklchToString(c: Oklch): string {
  const l = clamp(round(c.l), 0, 1);
  const chroma = clamp(round(c.c), 0, 0.5);
  const hue = round(normalizeHue(c.h), 2);
  return `oklch(${l} ${chroma} ${hue})`;
}

/**
 * Parse a CSS `oklch(L C H)` string back into an Oklch object.
 * Accepts forms like:
 *   oklch(0.58 0.22 25)
 *   oklch(0.58, 0.22, 25)
 *   oklch(58% 0.22 25)
 *   0.58 0.22 25
 * Returns { l:0, c:0, h:0 } on parse failure (defensive).
 */
export function oklchFromString(s: string): Oklch {
  if (!s) return { l: 0, c: 0, h: 0 };
  const trimmed = s.trim();
  const inner = trimmed.startsWith('oklch')
    ? trimmed.slice(trimmed.indexOf('(') + 1, trimmed.lastIndexOf(')'))
    : trimmed;
  const parts = inner
    .replace(/,/g, ' ')
    .replace(/\/.+$/, '') // drop alpha if present
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 3) return { l: 0, c: 0, h: 0 };
  const parseComponent = (raw: string, isPercentAllowed: boolean): number => {
    if (isPercentAllowed && raw.endsWith('%')) {
      return parseFloat(raw.slice(0, -1)) / 100;
    }
    return parseFloat(raw);
  };
  const l = parseComponent(parts[0] ?? '0', true);
  const c = parseComponent(parts[1] ?? '0', false);
  const h = parseComponent(parts[2] ?? '0', false);
  if (Number.isNaN(l) || Number.isNaN(c) || Number.isNaN(h)) {
    return { l: 0, c: 0, h: 0 };
  }
  return { l, c, h: normalizeHue(h) };
}

/**
 * Pick a near-white or near-black foreground that sits legibly on top of `bg`.
 * Uses the simple lightness heuristic — fine for v1 while we stay inside
 * reasonable chroma ranges for UI surfaces.
 *
 * Threshold ≈ 0.62 tends to flip at the right brand-red / brand-teal point.
 */
export function contrastForeground(bg: Oklch): Oklch {
  return bg.l > 0.62 ? { l: 0.145, c: 0, h: 0 } : { l: 0.985, c: 0, h: 0 };
}

/**
 * Shift an OKLCH color by deltas. Components clamp/normalize on the way out.
 * @example shift(primary, -0.1)          // 10% darker
 * @example shift(primary, 0, -0.05)      // desaturated
 * @example shift(primary, 0, 0, 15)      // rotate hue +15°
 */
export function shift(c: Oklch, dl: number, dc: number = 0, dh: number = 0): Oklch {
  return {
    l: clamp(c.l + dl, 0, 1),
    c: clamp(c.c + dc, 0, 0.5),
    h: normalizeHue(c.h + dh),
  };
}

/**
 * Linearly interpolate between two OKLCH colors.
 * Hue interpolation uses the shortest arc around the color wheel.
 * @param t 0..1 — 0 returns `a`, 1 returns `b`.
 */
export function mix(a: Oklch, b: Oklch, t: number): Oklch {
  const clamped = clamp(t, 0, 1);
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return {
    l: a.l + (b.l - a.l) * clamped,
    c: a.c + (b.c - a.c) * clamped,
    h: normalizeHue(a.h + dh * clamped),
  };
}

/**
 * Public surface of the theme-customizer slice.
 *
 * This slice extends Phase 2's `ThemeCustomizerSheet` with:
 *   - WCAG contrast feedback (ContrastBadge)
 *   - OKLCH-native slider picker (OklchPicker)
 *   - export / import of the theme as JSON (ExportImportPanel)
 *   - local custom-preset store (CustomPresetManager)
 *   - global `shift+t` shortcut hook (useKeyboardShortcut)
 *
 * The sheet itself lives at `@/components/theme/ThemeCustomizerSheet` — we
 * only export the sub-components and hooks here; the sheet composes them in.
 */
export { ContrastBadge } from './components/ContrastBadge';
export { OklchPicker } from './components/OklchPicker';
export { ExportImportPanel } from './components/ExportImportPanel';
export { CustomPresetManager } from './components/CustomPresetManager';
export { useKeyboardShortcut, useWcagContrast } from './hooks';
export type { WcagContrastResult, WcagLevel } from './hooks';

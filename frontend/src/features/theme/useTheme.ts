import { useContext } from 'react';
import { ThemeContext } from './ThemeProvider';
import type { ThemeContextValue } from './types';

/**
 * Returns the live theme context. Must be used under `<ThemeProvider>`;
 * throws a descriptive error otherwise so misconfiguration is caught loud.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error(
      'useTheme() must be used inside <ThemeProvider>. Wrap your app in AppProviders.',
    );
  }
  return ctx;
}

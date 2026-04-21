import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * vite.config.ts exports an async factory (because `rollup-plugin-visualizer`
 * is imported conditionally via dynamic import). We resolve it here before
 * handing to `mergeConfig`, which doesn't accept async factories directly.
 */
export default defineConfig(async (env) => {
  const resolved =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof viteConfig === 'function' ? await (viteConfig as any)(env) : viteConfig;

  return mergeConfig(resolved, {
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/setup-tests.ts'],
      globals: true,
      css: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['node_modules', 'dist', 'playwright', 'playwright-report'],
    },
  });
});

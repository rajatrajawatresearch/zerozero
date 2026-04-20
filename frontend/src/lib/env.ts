/**
 * Typed access to Vite-injected `import.meta.env` variables.
 *
 * All VITE_* keys are declared in `src/vite-env.d.ts` and documented
 * in the project's `.env.example`. Numeric values are coerced here
 * so downstream consumers never see `string` where a `number` is expected.
 */
export const env = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  WS_BASE_URL: import.meta.env.VITE_WS_BASE_URL,
  APP_NAME: import.meta.env.VITE_APP_NAME,
  DEFAULT_LAT: Number(import.meta.env.VITE_DEFAULT_LAT),
  DEFAULT_LNG: Number(import.meta.env.VITE_DEFAULT_LNG),
  MAP_TILES_URL: import.meta.env.VITE_MAP_TILES_URL,
  MAP_ATTRIBUTION: import.meta.env.VITE_MAP_ATTRIBUTION,
  IS_DEV: import.meta.env.DEV,
  IS_PROD: import.meta.env.PROD,
} as const;

export type Env = typeof env;

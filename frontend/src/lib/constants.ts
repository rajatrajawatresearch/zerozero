/**
 * Centralised string constants: localStorage keys, TanStack Query keys,
 * and frequently-used header / content-type values.
 *
 * Convention: localStorage keys are prefixed with `zz:` to avoid clashes
 * with other apps sharing the same origin in dev.
 */

/* -------------------------------------------------------------------------- */
/*                                Storage keys                                */
/* -------------------------------------------------------------------------- */
export const STORAGE_KEYS = {
  AUTH: 'zz:auth',
  CART: 'zz:cart',
  LOCATION: 'zz:location',
  THEME: 'zz:theme',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/* -------------------------------------------------------------------------- */
/*                              Query-key factory                             */
/* -------------------------------------------------------------------------- */
/**
 * Hierarchical query keys — Phase 2+ feature code should import from here
 * rather than typing string literals directly. Keeps invalidation targeted.
 *
 * Example:
 *   queryClient.invalidateQueries({ queryKey: QK.restaurants.all })
 */
export const QK = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  restaurants: {
    all: ['restaurants'] as const,
    list: (params?: Record<string, unknown>) =>
      ['restaurants', 'list', params ?? {}] as const,
    detail: (slug: string) => ['restaurants', 'detail', slug] as const,
    menu: (slug: string) => ['restaurants', 'menu', slug] as const,
  },
  categories: {
    all: ['categories'] as const,
  },
  cuisines: {
    all: ['cuisines'] as const,
  },
  search: {
    query: (q: string, lat?: number, lng?: number) =>
      ['search', q, lat, lng] as const,
  },
  cart: {
    current: ['cart'] as const,
  },
  orders: {
    all: ['orders'] as const,
    list: (filter?: string) => ['orders', 'list', filter ?? 'all'] as const,
    detail: (id: string) => ['orders', 'detail', id] as const,
  },
  addresses: {
    mine: ['addresses', 'mine'] as const,
  },
  notifications: {
    mine: ['notifications', 'mine'] as const,
  },
} as const;

/* -------------------------------------------------------------------------- */
/*                          HTTP + misc string constants                      */
/* -------------------------------------------------------------------------- */
export const HTTP = {
  HEADERS: {
    AUTHORIZATION: 'Authorization',
    CONTENT_TYPE: 'Content-Type',
    X_REQUEST_ID: 'X-Request-Id',
    ACCEPT: 'Accept',
  },
  CONTENT_TYPES: {
    JSON: 'application/json',
  },
} as const;

export const API_PATHS = {
  AUTH_REFRESH: '/auth/refresh',
  AUTH_LOGIN: '/auth/login',
  AUTH_SIGNUP: '/auth/signup',
  AUTH_LOGOUT: '/auth/logout',
  AUTH_ME: '/auth/me',
} as const;

/** Default request timeout in ms. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Reconnecting WS tuning knobs. */
export const WS_CONFIG = {
  BACKOFF_BASE_MS: 500,
  BACKOFF_FACTOR: 2,
  BACKOFF_CAP_MS: 30_000,
  HEARTBEAT_INTERVAL_MS: 25_000,
  HEARTBEAT_TIMEOUT_MS: 10_000,
} as const;

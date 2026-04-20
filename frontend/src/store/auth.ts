import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/lib/constants';
import type { AuthTokens, User } from '@/types';

/**
 * Auth store — holds the current session (user + access/refresh tokens)
 * and is persisted to localStorage under `zz:auth` so refreshes survive
 * page reloads.
 *
 * IMPORTANT: `useAuthStore.getState()` is read by `lib/api.ts` on every
 * request to attach the bearer token and to swap tokens after a silent
 * refresh. Do not rename the `accessToken` / `refreshToken` fields
 * without updating that consumer.
 */
export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;

  /** Full login/signup response — sets user and both tokens atomically. */
  setSession: (tokens: AuthTokens, user: User) => void;
  /** Only swap tokens (used by the silent refresh flow). */
  updateTokens: (tokens: AuthTokens) => void;
  /** Patch user fields without touching tokens (e.g. profile update). */
  setUser: (user: User) => void;
  /** Clear everything — used by logout and by 401 on the refresh endpoint. */
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,

      setSession: (tokens, user) =>
        set({
          user,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }),

      updateTokens: (tokens) =>
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }),

      setUser: (user) => set({ user }),

      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: STORAGE_KEYS.AUTH,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Only persist session primitives; avoid serialising method references.
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);

/* ------------------------------ Selectors -------------------------------- */
export const selectIsAuthenticated = (s: AuthState): boolean =>
  Boolean(s.accessToken && s.user);

export const selectUserRole = (s: AuthState) => s.user?.role ?? null;

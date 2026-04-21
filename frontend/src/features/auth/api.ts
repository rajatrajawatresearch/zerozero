/**
 * TanStack Query hooks for auth endpoints.
 *
 * Wire format from the backend is snake_case (see `types.ts`). The shared
 * `store/auth.ts` + `types/User` use camelCase though, so every mutation
 * maps `User` and `Tokens` at the boundary — UI code should never see
 * snake_case fields.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api';
import { API_PATHS, QK } from '@/lib/constants';
import { useAuthStore } from '@/store/auth';
import type {
  AuthTokens as StoreTokens,
  User as StoreUser,
} from '@/types';

import type {
  AuthResult,
  LoginIn,
  SignupIn,
  Tokens,
  User,
} from './types';

/* -------------------------------------------------------------------------- */
/*                                 Query keys                                  */
/* -------------------------------------------------------------------------- */
/**
 * Canonical query keys for auth. Mirrors `QK.auth` — exported locally so
 * feature consumers can `import { authKeys } from '@/features/auth'`.
 */
export const authKeys = {
  me: QK.auth.me,
} as const;

/* -------------------------------------------------------------------------- */
/*                         Wire <-> domain mappers                             */
/* -------------------------------------------------------------------------- */
function toStoreUser(u: User): StoreUser {
  // Build conditionally — `exactOptionalPropertyTypes` forbids setting
  // optional keys to `undefined` explicitly.
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    emailVerified: u.email_verified,
    isActive: true,
    createdAt: u.created_at,
    updatedAt: u.created_at,
    ...(u.phone ? { phone: u.phone } : {}),
    ...(u.avatar_url ? { avatarUrl: u.avatar_url } : {}),
  };
}

function toStoreTokens(t: Tokens): StoreTokens {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
  };
}

/** Commit a fresh `AuthResult` into the Zustand store + query cache. */
function commitSession(result: AuthResult, queryClient: ReturnType<typeof useQueryClient>): void {
  const user = toStoreUser(result.user);
  const tokens = toStoreTokens(result.tokens);
  useAuthStore.getState().setSession(tokens, user);
  // Seed /auth/me so the next `useMeQuery` render has data immediately.
  queryClient.setQueryData<User>(authKeys.me, result.user);
}

/* -------------------------------------------------------------------------- */
/*                                  Mutations                                  */
/* -------------------------------------------------------------------------- */
/** POST /auth/signup — creates an account and signs the user in. */
export function useSignupMutation(): UseMutationResult<AuthResult, Error, SignupIn> {
  const queryClient = useQueryClient();
  return useMutation<AuthResult, Error, SignupIn>({
    mutationFn: (body) =>
      api.post<AuthResult>(
        API_PATHS.AUTH_SIGNUP,
        body as unknown as Record<string, unknown>,
        { skipAuth: true },
      ),
    onSuccess: (data) => {
      commitSession(data, queryClient);
      void queryClient.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

/** POST /auth/login — exchanges credentials for a session. */
export function useLoginMutation(): UseMutationResult<AuthResult, Error, LoginIn> {
  const queryClient = useQueryClient();
  return useMutation<AuthResult, Error, LoginIn>({
    mutationFn: (body) =>
      api.post<AuthResult>(
        API_PATHS.AUTH_LOGIN,
        body as unknown as Record<string, unknown>,
        { skipAuth: true },
      ),
    onSuccess: (data) => {
      commitSession(data, queryClient);
      void queryClient.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

/**
 * POST /auth/logout — revokes the refresh token server-side, clears the
 * store, and wipes the entire query cache (user-scoped data must not leak
 * into the next session).
 */
export function useLogoutMutation(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      // Best-effort — even if the server call fails we still tear down locally.
      try {
        await api.post<void>(API_PATHS.AUTH_LOGOUT, undefined);
      } catch {
        // Swallow; local logout must always succeed.
      }
    },
    onSettled: () => {
      useAuthStore.getState().logout();
      queryClient.clear();
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                                    Query                                    */
/* -------------------------------------------------------------------------- */
/**
 * GET /auth/me — returns the current user. Enabled only when an access
 * token is present so logged-out shells don't spam the endpoint.
 */
export function useMeQuery(): UseQueryResult<User, Error> {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery<User, Error>({
    queryKey: authKeys.me,
    queryFn: () => api.get<User>(API_PATHS.AUTH_ME),
    enabled: !!accessToken,
    staleTime: 60_000,
  });
}

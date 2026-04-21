/**
 * Feature-level hooks composing the auth store, the /auth/me query, and
 * the login/signup/logout mutations into a single ergonomic surface for
 * UI code.
 */
import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuthStore, selectIsAuthenticated } from '@/store/auth';
import type { User as StoreUser } from '@/types';

import {
  useLoginMutation,
  useLogoutMutation,
  useMeQuery,
  useSignupMutation,
} from './api';
import type { LoginIn, SignupIn, User as WireUser } from './types';

/* -------------------------------------------------------------------------- */
/*                                   useAuth                                   */
/* -------------------------------------------------------------------------- */
/** Combined view of the server + client auth state. */
export interface UseAuthValue {
  /** Fresh `/auth/me` result if available, else the hydrated store user. */
  user: StoreUser | null;
  isAuthenticated: boolean;
  /** True while the bootstrap `/auth/me` is still loading. */
  isLoading: boolean;
  login: (input: LoginIn) => Promise<void>;
  signup: (input: SignupIn) => Promise<void>;
  logout: () => Promise<void>;
}

function wireToStoreUser(u: WireUser): StoreUser {
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

export function useAuth(): UseAuthValue {
  const storeUser = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);

  const meQuery = useMeQuery();

  const loginMutation = useLoginMutation();
  const signupMutation = useSignupMutation();
  const logoutMutation = useLogoutMutation();

  // Prefer the latest server truth; fall back to the persisted store.
  const user: StoreUser | null = meQuery.data
    ? wireToStoreUser(meQuery.data)
    : storeUser;

  const login = useCallback(
    async (input: LoginIn) => {
      await loginMutation.mutateAsync(input);
    },
    [loginMutation],
  );

  const signup = useCallback(
    async (input: SignupIn) => {
      await signupMutation.mutateAsync(input);
    },
    [signupMutation],
  );

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  return {
    user,
    isAuthenticated,
    // Only block while an in-flight me-query is loading for the first time.
    isLoading: meQuery.isLoading && meQuery.fetchStatus !== 'idle',
    login,
    signup,
    logout,
  };
}

/* -------------------------------------------------------------------------- */
/*                               useRequireAuth                                */
/* -------------------------------------------------------------------------- */
/**
 * Redirect to the login page if the user is not signed in. Preserves the
 * current location under `state.from` so the login screen can bounce the
 * user back after they authenticate.
 */
export function useRequireAuth(redirectTo = '/login'): void {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isAuthenticated) {
      void navigate(redirectTo, {
        replace: true,
        state: { from: location },
      });
    }
  }, [isAuthenticated, navigate, redirectTo, location]);
}

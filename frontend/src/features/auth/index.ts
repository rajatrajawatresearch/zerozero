/**
 * Public surface of the auth feature.
 *
 * Consumers — Agent 10 (FE-Layout) for `UserMenu` + `authRoutes`, every
 * other feature for `ProtectedRoute` + `useAuth` — should import only
 * from this barrel. Internal files (`api.ts`, `hooks.ts`, components,
 * pages) are implementation details.
 */
export { useAuth, useRequireAuth } from './hooks';
export type { UseAuthValue } from './hooks';

export { authRoutes } from './routes';

export { ProtectedRoute } from './components/ProtectedRoute';
export { UserMenu } from './components/UserMenu';

// Re-exported hooks for advanced consumers that need the raw mutations /
// query (e.g. custom flows). Most callers should prefer `useAuth`.
export {
  authKeys,
  useLoginMutation,
  useLogoutMutation,
  useMeQuery,
  useSignupMutation,
} from './api';

export type {
  AuthResult,
  LoginIn,
  SignupIn,
  Tokens,
  User as AuthUser,
} from './types';

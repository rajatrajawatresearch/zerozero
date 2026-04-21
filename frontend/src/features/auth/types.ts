/**
 * Auth feature TS mirrors of backend Pydantic v2 schemas.
 *
 * These match the wire format (snake_case) exactly — conversion to the
 * camelCase shape used by `store/auth.ts` and `types/User` happens inside
 * `api.ts` via explicit mapper functions so UI code always reads the same
 * domain shape regardless of where it came from.
 *
 * Contract source: `docs/PHASE2_CONTRACTS.md` — Auth section.
 */
import type { UserRole } from '@/types';

/* -------------------------------------------------------------------------- */
/*                            Wire-level (snake_case)                          */
/* -------------------------------------------------------------------------- */
/** `UserOut` — exact wire shape returned by backend `/auth/*` endpoints. */
export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  avatar_url: string | null;
  email_verified: boolean;
  created_at: string;
}

/** `TokensOut` — pair of JWTs + metadata. */
export interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

/** `SignupIn` — body for POST /auth/signup. */
export interface SignupIn {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
}

/** `LoginIn` — body for POST /auth/login. */
export interface LoginIn {
  email: string;
  password: string;
}

/** Combined auth response returned by signup/login. */
export interface AuthResult {
  user: User;
  tokens: Tokens;
}

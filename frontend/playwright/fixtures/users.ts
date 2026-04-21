/**
 * Shared test-user factories for Playwright E2E specs.
 *
 * - `demoCustomer` — the seeded customer account the backend ships with when
 *   running `python -m zerozero_api.seed --reset`. Use for flows that need
 *   pre-existing data (orders, addresses, reviews).
 * - `makeRandomUser()` — fresh email/password/name tuple, safe for concurrent
 *   runs. Email uses a UUID suffix + `@example.com` to stay within Zod's
 *   stricter email validator while not colliding between workers.
 *
 * Password policy (backend Pydantic `SignupIn`): min 8 chars, at least one
 * uppercase, at least one digit. `Test1234` satisfies all three.
 */
import { randomUUID } from 'node:crypto';

export interface TestUser {
  email: string;
  password: string;
  fullName: string;
}

export const demoCustomer: TestUser = {
  email: 'customer@test.com',
  password: 'test1234',
  fullName: 'Demo Customer',
};

export function makeRandomUser(): TestUser {
  const id = randomUUID();
  return {
    email: `e2e-${id}@example.com`,
    password: 'Test1234',
    fullName: 'E2E User',
  };
}

export default { demoCustomer, makeRandomUser };

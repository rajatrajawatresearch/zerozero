/**
 * Auth lifecycle — signup, logout, re-login, and a protected-route bounce.
 *
 * Each test spawns a fresh random user so workers don't step on each other.
 * The signup form itself hits the real `/auth/signup` endpoint (no mocks).
 */
import { expect, test } from '@playwright/test';

import { login, logout, signupAndLogin } from '../fixtures/helpers';
import { makeRandomUser } from '../fixtures/users';

test.describe('Auth flow', () => {
  test('signup → home shows avatar menu', async ({ page }) => {
    const user = makeRandomUser();
    await signupAndLogin(page, user);

    // The avatar dropdown trigger is labelled "Account menu" when authed.
    await expect(
      page.getByRole('button', { name: /account menu/i }),
    ).toBeVisible({ timeout: 10_000 });

    // And the public "Log in" link should NOT be present in the header chrome.
    await expect(page.getByRole('link', { name: /^log in$/i })).toHaveCount(0);
  });

  test('logout returns to the public header state', async ({ page }) => {
    const user = makeRandomUser();
    await signupAndLogin(page, user);
    await logout(page);

    await expect(
      page.getByRole('link', { name: /^log in$/i }).first(),
    ).toBeVisible();
  });

  test('can log in again with the same credentials', async ({ page }) => {
    const user = makeRandomUser();
    await signupAndLogin(page, user);
    await logout(page);

    await login(page, user);
    await expect(
      page.getByRole('button', { name: /account menu/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('protected route /addresses redirects guests to /login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/addresses');

    await page.waitForURL(/\/login/i, { timeout: 10_000 });
    await expect(
      page.getByRole('heading', { name: /welcome back/i }),
    ).toBeVisible();
  });
});

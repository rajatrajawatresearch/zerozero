/**
 * Reusable Playwright flow helpers.
 *
 * These do NOT stub the network — every helper exercises the real FE + BE
 * stack at `localhost:5173` / `localhost:8000` so failures surface regressions
 * in either layer.
 *
 * Selectors lean on roles + names (`getByRole`, `getByLabel`) rather than
 * CSS classes so styling refactors don't break the suite. Where the markup
 * doesn't expose a stable accessible name, we fall back to `getByText` on
 * copy that is load-bearing in the UI contract (e.g. the restaurant card
 * action text "Add").
 */
import { expect, type Page } from '@playwright/test';

import type { TestUser } from './users';

/* -------------------------------------------------------------------------- */
/*                                    Auth                                    */
/* -------------------------------------------------------------------------- */

/**
 * Sign up a brand-new account and wait for the post-signup redirect to land
 * on the home page. On success the header swaps in the avatar menu so we
 * assert the "Log in" link disappears as a cheap readiness check.
 */
export async function signupAndLogin(page: Page, user: TestUser): Promise<void> {
  await page.goto('/signup');

  await page.getByLabel(/full name/i).fill(user.fullName);
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/^password$/i).fill(user.password);

  await page.getByRole('button', { name: /create account/i }).click();

  await page.waitForURL('**/', { timeout: 15_000 });
  await expect(page.getByRole('link', { name: /log in/i })).toHaveCount(0, {
    timeout: 10_000,
  });
}

/**
 * Log in via `/login`. Mirrors `signupAndLogin` but assumes the account
 * already exists (demo user or a prior signup in the same spec).
 */
export async function login(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');

  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/^password$/i).fill(user.password);

  await page.getByRole('button', { name: /sign in/i }).click();

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 15_000,
  });
}

/**
 * Logout via the user-menu dropdown in the header. Called after a session
 * was established by `signupAndLogin` / `login`.
 */
export async function logout(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitem', { name: /log out/i }).click();

  await expect(page.getByRole('link', { name: /log in/i }).first()).toBeVisible({
    timeout: 10_000,
  });
}

/* -------------------------------------------------------------------------- */
/*                                    Cart                                    */
/* -------------------------------------------------------------------------- */

/**
 * From the home grid: open the first restaurant card, add its first visible
 * menu item, then tap the increment (+) button to land on qty=2.
 *
 * We rely on the MenuItemCard's accessible-name pattern:
 *   - initial state     → `<button>Add</button>`
 *   - after first add   → `<button aria-label="Increase <name> quantity">`
 */
export async function addFirstRestaurantFirstItemToCart(page: Page): Promise<void> {
  await page.goto('/');

  // Restaurant cards are `<a aria-label="<name> — view menu">`. Wait for at
  // least one to render so we know the grid query resolved.
  const firstCard = page.getByRole('link', { name: /view menu/i }).first();
  await firstCard.waitFor({ state: 'visible', timeout: 20_000 });
  await firstCard.click();

  // Detail page renders the menu as a collection of "Add" buttons.
  await page.waitForURL(/\/r\//, { timeout: 15_000 });
  const firstAdd = page.getByRole('button', { name: /^add$/i }).first();
  await firstAdd.waitFor({ state: 'visible', timeout: 20_000 });
  await firstAdd.click();

  // Once added, the Add button is replaced by a qty stepper. Click the
  // "Increase … quantity" button to reach qty=2.
  const increase = page
    .getByRole('button', { name: /increase .* quantity/i })
    .first();
  await increase.waitFor({ state: 'visible', timeout: 5_000 });
  await increase.click();
}

/* -------------------------------------------------------------------------- */
/*                                  Checkout                                  */
/* -------------------------------------------------------------------------- */

/**
 * Walk the 3-step checkout funnel using the default address + UPI, no promo,
 * and submit. Returns the UUID of the newly-created order (parsed from the
 * `/orders/<id>?new=1` redirect URL).
 */
export async function checkoutWithDefault(page: Page): Promise<string> {
  await page.goto('/checkout');

  // ----- Step 1: address (default auto-selected by AddressStep's effect) -----
  // `Continue` is inside the fixed bottom bar; wait until it's enabled.
  const continueBtn = page.getByRole('button', { name: /^continue$/i });
  await continueBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await expect(continueBtn).toBeEnabled({ timeout: 15_000 });
  await continueBtn.click();

  // ----- Step 2: payment → UPI -----
  await page.getByRole('radio', { name: /^UPI/i }).click();
  await expect(continueBtn).toBeEnabled({ timeout: 5_000 });
  await continueBtn.click();

  // ----- Step 3: review → place order -----
  const placeOrder = page.getByRole('button', { name: /place order/i });
  await placeOrder.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(placeOrder).toBeEnabled({ timeout: 10_000 });
  await placeOrder.click();

  // Checkout redirects to `/orders/<uuid>?new=1` on success.
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}/i, { timeout: 20_000 });

  const match = page.url().match(/\/orders\/([0-9a-f-]{36})/i);
  if (!match || !match[1]) {
    throw new Error(`Could not parse order id from URL: ${page.url()}`);
  }
  return match[1];
}

/* -------------------------------------------------------------------------- */
/*                                  Addresses                                 */
/* -------------------------------------------------------------------------- */

/**
 * Create a single saved address at `/addresses` using the provided coords
 * (defaults to Connaught Place, Delhi NCR). The map pre-fills lat/lng from
 * `env.DEFAULT_LAT|LNG`, so we only need to fill the text fields + tick the
 * default checkbox.
 */
export async function addDefaultAddress(
  page: Page,
  opts: {
    label?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    lat?: number;
    lng?: number;
  } = {},
): Promise<void> {
  const {
    label = 'Home',
    line1 = '1 Test Street',
    line2 = 'Near Rajiv Chowk',
    city = 'New Delhi',
    state = 'Delhi',
    pincode = '110001',
  } = opts;

  await page.goto('/addresses');

  await page.getByRole('button', { name: /add new address/i }).first().click();

  // The dialog hosts the form — scoping locators to it avoids bleed-over.
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });

  await dialog.getByLabel(/^label$/i).fill(label);
  await dialog.getByLabel(/^pincode$/i).fill(pincode);
  await dialog.getByLabel(/address line 1/i).fill(line1);
  await dialog.getByLabel(/address line 2/i).fill(line2);
  await dialog.getByLabel(/^city$/i).fill(city);
  await dialog.getByLabel(/^state$/i).fill(state);

  // Tick "Set as default" so checkout's AddressStep auto-selects it.
  await dialog
    .getByRole('checkbox', { name: /set as default/i })
    .click();

  await dialog.getByRole('button', { name: /save address/i }).click();

  // Dialog closes on success; wait for it to detach so the next action
  // doesn't race the close animation.
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
}

export default {
  signupAndLogin,
  login,
  logout,
  addFirstRestaurantFirstItemToCart,
  checkoutWithDefault,
  addDefaultAddress,
};

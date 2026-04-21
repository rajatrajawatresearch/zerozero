/**
 * Smoke tests — the cheapest-possible signal that the app shell is alive.
 *
 * All assertions run without authenticating so a hard regression in the
 * public landing page trips the suite before any user-gated flow.
 */
import { expect, test } from '@playwright/test';

test.describe('ZeroZero smoke', () => {
  test('app shell loads and shows brand', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ZeroZero/i);
    await expect(page.locator('body')).toContainText(/ZeroZero/i);
  });

  test('theme toggle flips the <html> class', async ({ page }) => {
    await page.goto('/');

    const root = page.locator('html');
    const initial = (await root.getAttribute('class')) ?? '';

    const toggle = page.getByRole('button', { name: /switch to (dark|light|system)/i });
    await toggle.click();

    // The theme provider writes a `dark` class + `data-theme` attribute onto
    // <html>. A single tap should flip one of them; we just assert that the
    // class string materially changed.
    await expect
      .poll(async () => (await root.getAttribute('class')) ?? '', { timeout: 5_000 })
      .not.toEqual(initial);
  });

  test('header cart button navigates to the cart page', async ({ page }) => {
    await page.goto('/');

    // Guest cart may say "Cart is empty" or "Cart with N items" — match either.
    await page
      .getByRole('link', { name: /cart (is empty|with \d+ item)/i })
      .click();

    await page.waitForURL('**/cart', { timeout: 10_000 });
    // The empty state copy is owned by `features/cart/components/EmptyCart.tsx`;
    // a generic "cart" heading is always present regardless of item count.
    await expect(
      page.getByRole('heading', { level: 1, name: /(your cart|cart is empty)/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  // Screenshot assertion is intentionally disabled in CI until a baseline is
  // committed — enabling it without a baseline fails every run.
  test.skip('visual baseline (opt-in)', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveScreenshot();
  });
});

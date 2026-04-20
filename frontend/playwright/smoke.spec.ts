import { expect, test } from '@playwright/test';

test.describe('ZeroZero smoke', () => {
  test('app shell loads and shows brand', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ZeroZero/i);
    await expect(page.locator('body')).toContainText(/ZeroZero/i);
  });
});

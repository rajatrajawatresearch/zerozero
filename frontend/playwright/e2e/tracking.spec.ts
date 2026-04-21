/**
 * Tracking spec — asserts the status stepper renders on a fresh order and,
 * when the share link is exposed, the public `/track/:shareToken` page loads
 * the same stepper without any auth.
 *
 * The WebSocket fan-out is exercised by the k6 scenario in Phase 5 A2; here
 * we stay deterministic and just sanity-check the render path that does not
 * depend on a second tab or a partner-sim driving location updates.
 */
import { expect, test } from '@playwright/test';

import {
  addDefaultAddress,
  addFirstRestaurantFirstItemToCart,
  checkoutWithDefault,
  signupAndLogin,
} from '../fixtures/helpers';
import { makeRandomUser } from '../fixtures/users';

test.describe('Order tracking', () => {
  test.setTimeout(120_000);

  test('order detail renders stepper and optionally the share-link track page', async ({
    page,
    context,
  }) => {
    const user = makeRandomUser();
    await signupAndLogin(page, user);

    await addDefaultAddress(page, {
      label: 'Home',
      line1: '1 Connaught Place',
      city: 'New Delhi',
      state: 'Delhi',
      pincode: '110001',
      lat: 28.61,
      lng: 77.2,
    });

    await addFirstRestaurantFirstItemToCart(page);
    const orderId = await checkoutWithDefault(page);

    // ----- 1. Stepper renders on the authed detail page ------------------
    await page.goto(`/orders/${orderId}`);
    const stepper = page.getByRole('list', { name: /order progress/i });
    await expect(stepper).toBeVisible({ timeout: 15_000 });
    await expect(stepper.getByText(/^placed$/i)).toBeVisible();

    // ----- 2. Share-link track page loads without auth -------------------
    // The "Share tracking link" button copies a URL of the form
    // `${origin}/track/<shareToken>`. We fish the token out of the DOM via
    // a network round-trip to `/orders/<id>` instead — simpler + no clipboard.
    const shareButton = page.getByRole('button', { name: /share tracking link/i });
    if (await shareButton.isVisible().catch(() => false)) {
      // Pull the order payload from the backend using the page's auth.
      const apiBase = 'http://localhost:8000';
      const res = await page.request.get(`${apiBase}/orders/${orderId}`);
      if (res.ok()) {
        const body = (await res.json()) as { share_token?: string | null };
        const token = body.share_token;
        if (token && /^[0-9a-f]{32}$/i.test(token)) {
          const guest = await context.browser()!.newContext();
          try {
            const guestPage = await guest.newPage();
            await guestPage.goto(`/track/${token}`);
            await expect(
              guestPage.getByRole('heading', { name: /order tracking/i }),
            ).toBeVisible({ timeout: 10_000 });
            await expect(
              guestPage.getByRole('list', { name: /order progress/i }),
            ).toBeVisible({ timeout: 15_000 });
          } finally {
            await guest.close();
          }
        }
      }
    }
  });
});

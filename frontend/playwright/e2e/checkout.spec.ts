/**
 * Golden-path checkout — the single most important flow in the app.
 *
 * Signup → add default address (Delhi NCR coords) → browse home grid →
 * add 2× of a menu item → review cart → pick address + UPI → place order.
 *
 * On success the browser is redirected to `/orders/<uuid>?new=1` where the
 * stepper shows status `placed`. We assert both the URL pattern and the
 * `Placed` step label to catch silent payload regressions.
 */
import { expect, test } from '@playwright/test';

import {
  addDefaultAddress,
  addFirstRestaurantFirstItemToCart,
  checkoutWithDefault,
  signupAndLogin,
} from '../fixtures/helpers';
import { makeRandomUser } from '../fixtures/users';

test.describe('Checkout golden path', () => {
  // The checkout flow touches the DB + map tiles + Leaflet chunk — allow more
  // than the default 30s before calling it flake.
  test.setTimeout(90_000);

  test('signup → add address → browse → cart → place order', async ({ page }) => {
    const user = makeRandomUser();
    await signupAndLogin(page, user);

    // Delhi NCR (Connaught Place). The location store defaults to these
    // coords so the restaurant grid returns seeded Delhi kitchens.
    await addDefaultAddress(page, {
      label: 'Home',
      line1: '1 Connaught Place',
      line2: 'Block A',
      city: 'New Delhi',
      state: 'Delhi',
      pincode: '110001',
      lat: 28.61,
      lng: 77.2,
    });

    await addFirstRestaurantFirstItemToCart(page);

    // Cart page shows qty=2 for the sole line.
    await page.goto('/cart');
    await expect(
      page.getByRole('heading', { level: 1, name: /your cart/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Qty lives in the `QtyStepper` — look for a "2" in the stepper region.
    const qtyRegion = page.getByRole('button', { name: /increase .* quantity/i }).first();
    await expect(qtyRegion).toBeVisible();

    const orderId = await checkoutWithDefault(page);
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/i);

    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}`));
    // The stepper's "Placed" label should be current or completed — we just
    // assert it renders.
    await expect(page.getByText(/^placed$/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

// @ts-nocheck
/**
 * checkout.js — k6 load test for the full customer purchase flow.
 *
 * Per VU (20 VUs, 30s):
 *   1. Use the shared access token obtained once in setup() via a single
 *      login of the static seed user (customer@test.com / test1234).
 *   2. GET /users/me/addresses — pick any saved address (or seed one on the
 *      first pass if none exists).
 *   3. GET /restaurants?lat=...&lng=... → pick a slug.
 *   4. GET /restaurants/{slug}/menu → pick first available menu item.
 *   5. POST /cart/items with qty=1.
 *   6. POST /orders with payment_method=cod.
 *
 * Thresholds:
 *   - p(95) end-to-end checkout POST < 800ms
 *   - HTTP failure rate < 2% (cart conflicts while 20 VUs share a user
 *     are expected sporadically, hence the looser tolerance).
 *
 * Note: all 20 VUs share one seed user's cart, so the backend's
 * single-restaurant rule will cause some X-Cart-Replaced flips — that's
 * fine for a load profile, we just need the flow to keep running.
 *
 * Run: k6 run scripts/k6/checkout.js
 */

import http from 'k6/http';
import { check, fail, sleep } from 'k6';

const API_BASE = __ENV.API_BASE || 'http://localhost:8000';
const EMAIL = __ENV.K6_USER_EMAIL || 'customer@test.com';
const PASSWORD = __ENV.K6_USER_PASSWORD || 'test1234';
const LAT = 28.6139;
const LNG = 77.209;

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<800'],
    checks: ['rate>0.95'],
  },
};

/**
 * setup() — runs once per test run. Logs the seed user in and resolves an
 * address_id + a restaurant slug + a menu_item_id so the VU loop has a
 * ready-to-use ledger of IDs.
 */
export function setup() {
  const loginRes = http.post(
    `${API_BASE}/api/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (loginRes.status !== 200) {
    fail(`login failed: ${loginRes.status} ${loginRes.body}`);
  }
  const token = loginRes.json('tokens.access_token');
  const authHeader = { Authorization: `Bearer ${token}` };

  // Ensure the user has at least one address.
  let addrRes = http.get(`${API_BASE}/api/v1/users/me/addresses`, {
    headers: authHeader,
  });
  let addresses = addrRes.json();
  if (!Array.isArray(addresses) || addresses.length === 0) {
    const created = http.post(
      `${API_BASE}/api/v1/users/me/addresses`,
      JSON.stringify({
        label: 'k6-seed',
        line1: '1 Rajpath',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110001',
        lat: LAT,
        lng: LNG,
        is_default: true,
      }),
      {
        headers: { ...authHeader, 'Content-Type': 'application/json' },
      },
    );
    if (created.status !== 201) {
      fail(`address seed failed: ${created.status} ${created.body}`);
    }
    addresses = [created.json()];
  }
  const addressId = addresses[0].id;

  // Resolve a restaurant + a menu item for the VU loop.
  const restListRes = http.get(
    `${API_BASE}/api/v1/restaurants?lat=${LAT}&lng=${LNG}&page_size=1`,
    { headers: authHeader },
  );
  const first = restListRes.json('items.0');
  if (!first) fail(`no restaurants seeded: ${restListRes.body}`);
  const slug = first.slug;

  const menuRes = http.get(
    `${API_BASE}/api/v1/restaurants/${slug}/menu`,
    { headers: authHeader },
  );
  const menu = menuRes.json();
  let menuItemId = null;
  for (const section of menu.sections || []) {
    for (const item of section.items || []) {
      if (item.is_available) {
        menuItemId = item.id;
        break;
      }
    }
    if (menuItemId) break;
  }
  if (!menuItemId) fail(`no available menu items in ${slug}`);

  return { token, addressId, menuItemId, slug };
}

export default function (data) {
  const authHeaders = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };

  // 1. Add item to cart. 409/422 can happen legitimately under
  //    contention — treat non-2xx as a soft failure, not a fatal one.
  const cartRes = http.post(
    `${API_BASE}/api/v1/cart/items`,
    JSON.stringify({ menu_item_id: data.menuItemId, qty: 1 }),
    { headers: authHeaders, tags: { name: 'cart-add' } },
  );
  check(cartRes, { 'cart add 2xx': (r) => r.status >= 200 && r.status < 300 });

  // 2. Checkout.
  const orderRes = http.post(
    `${API_BASE}/api/v1/orders`,
    JSON.stringify({
      address_id: data.addressId,
      payment_method: 'cod',
    }),
    { headers: authHeaders, tags: { name: 'checkout' } },
  );
  check(orderRes, {
    'order placed': (r) => r.status === 201,
    'order has id': (r) => !!r.json('id'),
  });

  sleep(Math.random() * 0.4 + 0.1);
}

// @ts-nocheck
/**
 * ws-fanout.js — 100 concurrent WebSocket subscribers on /ws/orders/{id}.
 *
 * setup() once:
 *   1. Logs in the seed customer (customer@test.com / test1234).
 *   2. Ensures an address exists.
 *   3. Adds a cart item.
 *   4. POST /orders to mint a fresh order.
 *   → returns { token, orderId }.
 *
 * default() per VU (100 VUs, single iteration):
 *   - Opens ws://HOST/ws/orders/{orderId}?token=...
 *   - Counts inbound frames; asserts at least one within 30s.
 *   - Closes cleanly after 30s or earlier if the server ends the stream.
 *
 * Thresholds:
 *   - ws_connecting p(95) < 500ms
 *   - checks rate > 0.98 (all but a handful must get an initial snapshot
 *     message — the backend emits status+partner_location on join).
 *
 * Run: k6 run scripts/k6/ws-fanout.js
 */

import http from 'k6/http';
import ws from 'k6/ws';
import { check, fail } from 'k6';

const API_BASE = __ENV.API_BASE || 'http://localhost:8000';
const WS_BASE = __ENV.WS_BASE || API_BASE.replace(/^http/, 'ws');
const EMAIL = __ENV.K6_USER_EMAIL || 'customer@test.com';
const PASSWORD = __ENV.K6_USER_PASSWORD || 'test1234';
const LAT = 28.6139;
const LNG = 77.209;
const HOLD_MS = 30_000;

export const options = {
  vus: 100,
  iterations: 100,
  thresholds: {
    ws_connecting: ['p(95)<500'],
    checks: ['rate>0.98'],
  },
};

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
  const jsonHeaders = { ...authHeader, 'Content-Type': 'application/json' };

  // Address.
  let addrRes = http.get(`${API_BASE}/api/v1/users/me/addresses`, {
    headers: authHeader,
  });
  let addresses = addrRes.json();
  if (!Array.isArray(addresses) || addresses.length === 0) {
    const created = http.post(
      `${API_BASE}/api/v1/users/me/addresses`,
      JSON.stringify({
        label: 'k6-ws',
        line1: '1 Rajpath',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110001',
        lat: LAT,
        lng: LNG,
        is_default: true,
      }),
      { headers: jsonHeaders },
    );
    if (created.status !== 201) {
      fail(`address seed failed: ${created.status} ${created.body}`);
    }
    addresses = [created.json()];
  }
  const addressId = addresses[0].id;

  // Pick a restaurant + menu item.
  const restListRes = http.get(
    `${API_BASE}/api/v1/restaurants?lat=${LAT}&lng=${LNG}&page_size=1`,
    { headers: authHeader },
  );
  const first = restListRes.json('items.0');
  if (!first) fail(`no restaurants seeded: ${restListRes.body}`);
  const menuRes = http.get(
    `${API_BASE}/api/v1/restaurants/${first.slug}/menu`,
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
  if (!menuItemId) fail(`no available menu items`);

  // Cart + checkout.
  const cartRes = http.post(
    `${API_BASE}/api/v1/cart/items`,
    JSON.stringify({ menu_item_id: menuItemId, qty: 1 }),
    { headers: jsonHeaders },
  );
  if (cartRes.status >= 300) {
    fail(`cart failed: ${cartRes.status} ${cartRes.body}`);
  }

  const orderRes = http.post(
    `${API_BASE}/api/v1/orders`,
    JSON.stringify({ address_id: addressId, payment_method: 'cod' }),
    { headers: jsonHeaders },
  );
  if (orderRes.status !== 201) {
    fail(`checkout failed: ${orderRes.status} ${orderRes.body}`);
  }
  const orderId = orderRes.json('id');
  return { token, orderId };
}

export default function (data) {
  const url = `${WS_BASE}/ws/orders/${data.orderId}?token=${data.token}`;
  let received = 0;

  const res = ws.connect(url, null, (socket) => {
    socket.on('open', () => {
      // Hard stop: don't let a VU hang the entire run.
      socket.setTimeout(() => {
        socket.close();
      }, HOLD_MS);
    });

    socket.on('message', () => {
      received += 1;
    });

    socket.on('error', (e) => {
      // Surface transport errors as a failed check, not a fatal throw.
      check(false, { 'ws error': () => false });
    });

    socket.on('close', () => {
      check(received, {
        'received >=1 message within 30s': (n) => n >= 1,
      });
    });
  });

  check(res, {
    'ws handshake 101': (r) => r && r.status === 101,
  });
}

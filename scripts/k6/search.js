// @ts-nocheck
/**
 * search.js — k6 load test for /api/v1/search
 *
 * Scenario: 50 VUs for 1 minute (10s ramp-up), each VU hitting the search
 * endpoint with a randomly picked query word. Targets Connaught Place
 * (Delhi) coordinates so the backend's geo-ranked search kicks in.
 *
 * Thresholds:
 *   - p(95) latency < 400ms under 50 concurrent users
 *   - HTTP failure rate < 1%
 *
 * Run: k6 run scripts/k6/search.js
 *     (override API base via -e API_BASE=http://host:port)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const API_BASE = __ENV.API_BASE || 'http://localhost:8000';
const QUERIES = ['pizza', 'biryani', 'momo', 'coffee', 'dosa'];
const LAT = 28.6139;
const LNG = 77.209;

export const options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '50s', target: 50 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<400'],
  },
};

export default function () {
  const q = randomItem(QUERIES);
  const url = `${API_BASE}/api/v1/search?q=${encodeURIComponent(q)}&lat=${LAT}&lng=${LNG}`;

  const res = http.get(url, {
    tags: { name: 'search' },
    headers: { Accept: 'application/json' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'body is json array/object': (r) =>
      typeof r.body === 'string' && r.body.length > 2,
  });

  // Small think-time to simulate human typing between searches.
  sleep(Math.random() * 0.5 + 0.2);
}

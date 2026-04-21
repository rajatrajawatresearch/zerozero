# ZeroZero — Load & Performance Scripts

This directory holds the k6 load-test scripts used by Phase 5. They exercise
the backend end-to-end through real HTTP + WebSocket traffic — no mocks.

## Install k6

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows (scoop)
scoop install k6
```

Verify install: `k6 version`.

## Prerequisites for every run

1. Backend running on `http://localhost:8000` (the default — override with
   `-e API_BASE=https://staging.zerozero.app`).
2. Database seeded via `uv run python -m zerozero_api.seed --reset` so the
   static demo user `customer@test.com` / `test1234` exists.
3. Redis up (WebSocket pub/sub needs it).

From the repo root:

```bash
docker compose up -d db redis
cd backend && uv run alembic upgrade head && uv run python -m zerozero_api.seed --reset
uv run uvicorn zerozero_api.main:app --port 8000
```

## Run the tests

```bash
# 50 VUs × 1 min — search endpoint with rotating query words
k6 run scripts/k6/search.js

# 20 VUs × 30s — full auth → cart → checkout flow
k6 run scripts/k6/checkout.js

# 100 VUs fan-out on /ws/orders/{id}
k6 run scripts/k6/ws-fanout.js
```

### Environment overrides

All scripts honour these vars:

| Var                | Default                   | Purpose                              |
|--------------------|---------------------------|--------------------------------------|
| `API_BASE`         | `http://localhost:8000`   | Backend HTTP root.                   |
| `WS_BASE`          | derived (`ws://…`)        | Override for WSS / separate host.    |
| `K6_USER_EMAIL`    | `customer@test.com`       | Seed customer login email.           |
| `K6_USER_PASSWORD` | `test1234`                | Seed customer login password.        |

Example:

```bash
k6 run -e API_BASE=https://staging.zerozero.app scripts/k6/search.js
```

## Target thresholds

These thresholds are enforced in each script via `options.thresholds` and
will fail the run with a non-zero exit code if breached.

| Script             | VUs | Duration | Key thresholds                                       |
|--------------------|-----|----------|------------------------------------------------------|
| `search.js`        | 50  | 1 min    | `http_req_duration p(95) < 400ms`, `failed < 1%`     |
| `checkout.js`      | 20  | 30 s     | `http_req_duration p(95) < 800ms`, `failed < 2%`     |
| `ws-fanout.js`     | 100 | 1 iter   | `ws_connecting p(95) < 500ms`, `checks > 98%`        |

## Lighthouse CI (frontend perf/a11y gate)

Configured in `frontend/lighthouserc.json` and wired into
`.github/workflows/lighthouse.yml` (runs on every PR). Thresholds:

- Performance ≥ 0.85
- Accessibility ≥ 0.95
- Best Practices ≥ 0.90
- SEO ≥ 0.90

Run locally:

```bash
cd frontend
pnpm build
npx @lhci/cli autorun
```

## Notes

- The scripts use `// @ts-nocheck` because k6's `http`, `k6/ws`, and
  `k6-utils` imports resolve inside the k6 runtime, not Node — so editor
  TS resolution would otherwise flag them.
- Do NOT run these against production. They hammer auth, create real
  orders, and open 100 concurrent WebSockets.

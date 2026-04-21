# Playwright E2E — ZeroZero

Browser-driven smoke + regression suite for the ZeroZero frontend. Every spec
talks to the real stack (`localhost:5173` Vite + `localhost:8000` FastAPI) and
exercises real seeded data — there is **no mocking**. Regressions in either
layer trip the suite.

## Layout

```
playwright/
  smoke.spec.ts            legacy minimal smoke (kept for docker CI)
  e2e/
    smoke.spec.ts          app-shell + theme + cart-button smoke
    auth.spec.ts           signup → logout → re-login → protected redirect
    checkout.spec.ts       golden path: signup → address → cart → place order
    tracking.spec.ts       order detail stepper + public share-link view
  fixtures/
    users.ts               `demoCustomer` + `makeRandomUser()`
    helpers.ts             reusable page flows (login, cart, checkout)
```

## Running

Prerequisites:

1. Backend stack up with seeded data:
   ```bash
   docker compose up db redis
   cd backend && uv run alembic upgrade head
   uv run python -m zerozero_api.seed --reset
   uv run uvicorn zerozero_api.main:app --reload --port 8000
   ```
2. Frontend dev server (or the Playwright config will spawn `pnpm dev`):
   ```bash
   cd frontend && pnpm install
   ```
3. First-time browser install:
   ```bash
   pnpm exec playwright install --with-deps chromium
   ```

Then:

```bash
# Full suite (Chromium project only — Firefox/WebKit can be added later)
pnpm test:e2e

# Single spec
pnpm exec playwright test playwright/e2e/checkout.spec.ts

# Headed debugging
pnpm exec playwright test --headed --workers=1

# UI-mode (interactive picker)
pnpm exec playwright test --ui
```

## Environment variables

| Var               | Default                  | Notes                                                 |
|-------------------|--------------------------|-------------------------------------------------------|
| `E2E_BASE_URL`    | `http://localhost:5173`  | Honoured by `playwright.config.ts` via `baseURL`.     |
| `CI`              | *(unset)*                | When truthy: 2 retries, GitHub reporter, 1 worker.    |

The backend URL is currently hard-coded in the tracking spec as
`http://localhost:8000`; extend `playwright.config.ts` with a `use.extraHTTPHeaders`
or a typed test fixture if you need it overridable.

## Test users

- **Demo**: `customer@test.com` / `test1234` — seeded by the backend's
  `zerozero_api.seed` module. Use for data-heavy flows (orders list, past
  reviews).
- **Random**: `makeRandomUser()` generates a fresh `e2e-<uuid>@example.com`
  account per test so parallel workers stay isolated.

## Adding a spec

1. Drop the file under `playwright/e2e/` so it inherits the Chromium project.
2. Prefer role-based locators (`getByRole`, `getByLabel`) over CSS selectors —
   they survive Tailwind refactors.
3. Reuse fixtures from `playwright/fixtures/`. If you add new shared flows,
   export them from `helpers.ts` with a JSDoc explaining *why* they exist.
4. Tag any WebSocket-driven assertion with `test.setTimeout()` — tile loads +
   socket handshakes push past the default 30s on cold starts.

# Phase 5 + 6 — Integration + Deploy

**Agents: 6 total (4 integration + 2 deploy)** — run in parallel.

## Phase 5 — Integration

### Agent A1: Playwright E2E
**Paths:**
- `frontend/playwright/e2e/{smoke,auth,checkout,tracking}.spec.ts`
- `frontend/playwright/fixtures/{users,helpers}.ts`
- Update `frontend/playwright.config.ts` if needed (additional projects)

**Coverage:**
- `smoke.spec.ts`: / loads, branding visible, theme toggle works
- `auth.spec.ts`: signup → auto-login, logout, re-login, protected route redirect
- `checkout.spec.ts` (**golden path**): login → set address → browse restaurants → open detail → add 2 items to cart → /cart → /checkout → pick address → pay → land on /orders/:id with status="placed"
- `tracking.spec.ts`: load /orders/:id, polling update visible (partner-sim in another tab drives it — or just mock via seeded scenario)

### Agent A2: k6 load + Lighthouse CI
**Paths:**
- `frontend/lighthouserc.json` + GitHub Action workflow `.github/workflows/lighthouse.yml`
- `scripts/k6/{search,checkout,ws-fanout}.js`
- `scripts/README.md`

**Content:**
- Lighthouse thresholds: perf ≥ 85, a11y ≥ 95, best-practices ≥ 90, SEO ≥ 90
- k6 scripts with 50 VUs / 1min runs on `/restaurants`, `/search`, `/cart`
- WS k6 scenario using `k6/ws` module: 100 concurrent `/ws/orders/{id}` subs while POSTing partner locations

### Agent A3: Accessibility audit + fixes
**Paths:** additive only — edit any component that fails axe checks. Document findings in `docs/A11Y_AUDIT.md`.
- Run axe-core via Playwright (`@axe-core/playwright`) on top 5 pages
- Fix issues: missing alt, low contrast (rare since we use OKLCH tokens), missing landmarks, keyboard traps
- Add `/docs/A11Y_AUDIT.md` with before/after summary

### Agent A4: Bundle analysis + dead code
**Paths:**
- Add `vite-bundle-visualizer` as dev dep (in package.json — add one line)
- `docs/BUNDLE_REPORT.md` with screenshot-like breakdown
- Use `vite build --report` output to identify heavy chunks
- Suggest `manualChunks` for vendor split (react, radix, leaflet) if > 500kB gzip on main

## Phase 6 — Deploy

### Agent D1: Multi-stage Dockerfiles + prod compose + Caddy
**Paths:**
- `backend/Dockerfile` — upgrade to multi-stage (builder + runtime)
- `frontend/Dockerfile` — multi-stage (builder + nginx or static via caddy)
- `docker-compose.prod.yml` — production stack with Caddy reverse proxy + TLS
- `Caddyfile` at repo root
- `docs/DEPLOY.md` — runbook

**Caddyfile:**
```
{$DOMAIN:localhost} {
  handle /api/* {
    reverse_proxy backend:8000
  }
  handle /ws/* {
    reverse_proxy backend:8000
  }
  handle /uploads/* {
    reverse_proxy backend:8000
  }
  handle /* {
    reverse_proxy frontend:80
  }
}
```

### Agent D2: GitHub Actions deploy workflow + observability
**Paths:**
- `.github/workflows/deploy.yml` — on push to main, build + push images to GHCR, SSH to VPS, pull + compose up
- `.github/workflows/ci.yml` — already exists; extend with frontend typecheck + build
- `docs/OBSERVABILITY.md` — Sentry DSN configuration, structlog JSON ingestion pattern, OpenTelemetry next steps

## Rules

- Keep all edits additive unless fixing an a11y bug
- Don't change pyproject.toml or package.json beyond adding vite-bundle-visualizer (Agent A4) and @axe-core/playwright (Agent A3)
- All deploy assets should assume docker-compose runs behind Caddy; no nginx config needed

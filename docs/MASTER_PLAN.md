# ZeroZero — Zomato-style Food Delivery Clone
## Master Implementation Plan (Parallel Worktree Edition)

**Owner:** Rajat
**Created:** 2026-04-20
**Target:** Production-ready clone with real-time ops, dynamic theming, location intelligence
**Execution model:** git worktrees + parallel Claude Code sessions

---

## 1. Product Goals (What "done" looks like)

A fully working food-delivery web app where a user can:
1. Sign up / log in (email + optional Google OAuth)
2. Detect / set delivery location, see **only** restaurants that deliver to that point (PostGIS radius)
3. Browse, search, filter restaurants + menus
4. Add to cart, apply promo, mock-checkout
5. Track order in **real-time** (WebSocket status stepper)
6. Watch a **live moving marker** of the delivery partner on a map
7. Share a public tracking link with anyone (no login needed)
8. Rate + review after delivery
9. Customize the entire app's color theme live (primary/accent/mode/preset)
10. Admin/restaurant partner can manage menu + orders

---

## 2. Tech Stack (with rationale)

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | **React 19 + Vite 6 + TypeScript 5** | React 19 `use()` hook, Suspense, transitions ideal for live data |
| UI kit | **shadcn/ui (canary) + Tailwind CSS v4** | CSS vars + OKLCH = effortless dynamic theming |
| State — server | **TanStack Query v5** | Cache, retry, optimistic updates for cart/orders |
| State — client | **Zustand + zustand/persist** | Cart + theme persistence, tiny bundle |
| Forms | **react-hook-form + zod** | Type-safe validation, shadcn Form wrapper |
| Maps | **Leaflet + react-leaflet** | Free, no API-key, OSM tiles |
| Realtime FE | **Native WebSocket + reconnecting wrapper** | No extra SDK, works with FastAPI |
| Backend | **FastAPI 0.115 + Uvicorn + Python 3.12** | Async, Pydantic v2, WS built-in |
| ORM | **SQLAlchemy 2.0 async + Alembic** | Mature, async, PostGIS via `geoalchemy2` |
| DB | **PostgreSQL 16 + PostGIS 3.4** | Geo queries (`ST_DWithin`), tsvector full-text |
| Cache + pub/sub | **Redis 7** | Session cache, WS fan-out, rate limit |
| Auth | **JWT (access 15m + refresh 7d) + argon2** | Stateless, secure password hashing |
| Geocoding | **Nominatim (OSM) self-hosted or public** | Free, no vendor lock |
| Testing FE | **Vitest + Testing Library + Playwright** | Unit + E2E |
| Testing BE | **pytest + pytest-asyncio + httpx + testcontainers** | Real Postgres in tests, no mocks |
| Observability | **Sentry + structlog + OpenTelemetry** | Error + traces |
| Deploy | **Docker + docker-compose + GitHub Actions + Caddy** | Simple, reproducible |

---

## 3. Repository Layout (Monorepo)

```
zerozero/
├── .github/workflows/        # CI pipelines
├── backend/                  # FastAPI app
│   ├── src/zerozero_api/
│   │   ├── __init__.py
│   │   ├── main.py           # app factory
│   │   ├── settings.py       # pydantic-settings
│   │   ├── core/             # db, security, deps
│   │   ├── domain/           # models (SQLAlchemy)
│   │   ├── schemas/          # Pydantic DTOs
│   │   ├── routers/          # HTTP endpoints
│   │   ├── services/         # business logic
│   │   ├── ws/               # websocket endpoints + connection manager
│   │   ├── geo/              # PostGIS query helpers
│   │   └── seed/             # Faker-based seeders
│   ├── alembic/
│   ├── tests/
│   └── pyproject.toml
├── frontend/                 # React app
│   ├── src/
│   │   ├── app/              # router, providers
│   │   ├── features/         # auth, restaurants, cart, orders, tracking, theme
│   │   ├── components/ui/    # shadcn primitives
│   │   ├── components/       # shared composed components
│   │   ├── lib/              # api client, ws client, hooks
│   │   ├── store/            # zustand stores
│   │   ├── styles/           # global.css, theme.css
│   │   └── types/            # shared types (generated from backend OpenAPI)
│   ├── tests/
│   ├── playwright/
│   └── package.json
├── database/
│   ├── init/                 # init SQL (CREATE EXTENSION postgis)
│   └── seed-data/            # JSON fixtures: cuisines, sample restaurants
├── contracts/                # shared OpenAPI snapshot + generated TS types
├── docker-compose.yml        # dev: postgres + redis + backend + frontend
├── docker-compose.prod.yml
├── docs/
│   ├── MASTER_PLAN.md        # this file
│   ├── ERD.md
│   ├── API.md
│   ├── WORKTREE_PLAYBOOK.md
│   └── THEMING.md
├── scripts/                  # dev utility scripts
├── .env.example
└── README.md
```

---

## 4. Database ERD (core tables)

```
users              addresses           restaurants          menu_items
─────              ─────────           ───────────          ──────────
id (uuid)          id                  id                   id
email UK           user_id FK          owner_id FK          restaurant_id FK
phone              label               name                 category_id FK
password_hash      line1               slug UK              name
full_name          city                cuisines[]           description
role (enum)        pincode             location geography   price
avatar_url         location geography  delivery_radius_m    image_url
created_at         is_default          rating_avg           is_veg
                                       rating_count         variants jsonb
                                       opens_at, closes_at  tags[]
                                       image_url            is_available
                                       is_active

cart_items         orders              order_items          order_status_events
──────────         ──────              ───────────          ───────────────────
id                 id                  id                   id
user_id FK         user_id FK          order_id FK          order_id FK
restaurant_id FK   restaurant_id FK    menu_item_id FK      status (enum)
menu_item_id FK    address_id FK       name_snapshot        note
qty                subtotal            price_snapshot       actor (enum)
options jsonb      discount            qty                  created_at
                   delivery_fee        options jsonb
                   tax
                   total
                   status (enum)
                   placed_at
                   delivered_at
                   partner_id FK NULL

delivery_partners  partner_locations   reviews              promo_codes
─────────────────  ──────────────────  ───────             ────────────
id                 id                  id                   id
user_id FK         partner_id FK       order_id FK UK       code UK
vehicle            location geography  user_id FK           discount_type
current_order_id   recorded_at         restaurant_id FK     value
is_online                              rating (1-5)         min_order
location geography                     comment              max_discount
                                       images[]             valid_from
                                       created_at           valid_to
                                                            usage_limit

categories         cuisines            notifications        theme_presets
──────────         ────────            ─────────────        ─────────────
id                 id                  id                   id
name               name                user_id FK           user_id FK NULL (null=public)
icon               icon                type                 name
sort_order         is_veg_only         payload jsonb        primary_oklch
                                       is_read              accent_oklch
                                       created_at           mode (light/dark/system)
                                                            radius (sm/md/lg)
```

### Key PostGIS indexes
```sql
CREATE INDEX idx_restaurants_location ON restaurants USING GIST (location);
CREATE INDEX idx_addresses_location   ON addresses   USING GIST (location);
CREATE INDEX idx_partner_loc_recent   ON partner_locations (partner_id, recorded_at DESC);
CREATE INDEX idx_restaurants_fts      ON restaurants USING GIN (to_tsvector('english', name || ' ' || coalesce(array_to_string(cuisines,' '),'')));
```

### Key query — "restaurants that deliver to me"
```sql
SELECT r.*
FROM restaurants r
WHERE r.is_active
  AND ST_DWithin(
        r.location,
        ST_MakePoint(:lng, :lat)::geography,
        r.delivery_radius_m
      )
ORDER BY r.location <-> ST_MakePoint(:lng, :lat)::geography
LIMIT 50;
```

---

## 5. API Surface (REST + WS)

### REST (prefix `/api/v1`)
```
POST   /auth/signup
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me

GET    /users/me
PATCH  /users/me
GET    /users/me/addresses
POST   /users/me/addresses
DELETE /users/me/addresses/{id}

GET    /restaurants?lat=&lng=&cuisine=&q=&sort=&veg=&page=
GET    /restaurants/{slug}
GET    /restaurants/{slug}/menu
GET    /categories
GET    /cuisines

GET    /search?q=&lat=&lng=    # unified fuzzy across restaurants + items

POST   /cart/items
PATCH  /cart/items/{id}
DELETE /cart/items/{id}
GET    /cart
DELETE /cart

POST   /orders                 # checkout
GET    /orders
GET    /orders/{id}
POST   /orders/{id}/cancel
POST   /orders/{id}/review

POST   /promos/validate

POST   /payments/mock/charge
POST   /payments/webhook

# partner-side (delivery)
POST   /partner/online
POST   /partner/location       # batched coordinate push
POST   /partner/orders/{id}/accept
POST   /partner/orders/{id}/status

# admin / restaurant owner
POST   /admin/restaurants
PATCH  /admin/restaurants/{id}
POST   /admin/menu-items
PATCH  /admin/menu-items/{id}

GET    /health
```

### WebSocket
```
/ws/orders/{order_id}?token=...      # order status + partner location stream
/ws/partner?token=...                # partner receives assignment
/ws/public/track/{share_token}       # no-auth share link
```

---

## 6. Worktree & Parallel Session Strategy

### The core idea
Har feature ek alag git worktree me banega. Ek repo, multiple working directories, each on its own branch. Har worktree me ek independent Claude Code session chalega. Phase boundaries = sync points.

### Setup once (after Phase 0 merge)
```bash
cd ~/zerozero
# main branch stays clean
git worktree add ../zerozero-auth         feature/auth
git worktree add ../zerozero-restaurants  feature/restaurants
git worktree add ../zerozero-location     feature/location
# ... one per feature branch
```

Each worktree path becomes the `cwd` for one parallel Claude session.

### Branch strategy
- `main` — stable, integration target
- `develop` — phase integration branch (optional if team size warrants)
- `feature/<name>` — one per phase-task
- Protected: nobody commits to `main` directly; only merges from `develop` or `feature/*` after green CI

### Coordination rules
1. **Contract-first.** Before any parallel work in a phase, the first commit in that phase updates `contracts/openapi.yaml` + generated TS types. All parallel sessions pull this contract and code against it.
2. **No DB migration collisions.** Only one session per phase creates Alembic migrations. That session is the "lead" for the phase.
3. **Shared components in `frontend/src/components/ui/*` are additive only** during parallel phases — no edits to existing files, only new files. Breaking changes get bundled into a separate "ui-refactor" branch.
4. **Daily rebase.** Each worktree rebases on `main` every day: `git fetch && git rebase origin/main`.
5. **Merge order is published in phase doc.** Usually: db → backend → frontend → tests.

### When to spawn a new Claude Code session
- **Fresh session per worktree per day.** Context windows are finite; start fresh in the morning with `CLAUDE.md` + `docs/MASTER_PLAN.md` auto-loaded.
- Use `/resume` only for continuing a same-day task.

### Session kickoff prompt template
```
Context: ZeroZero project. I am on worktree `feature/<name>` at `~/zerozero-<name>`.
Read docs/MASTER_PLAN.md and docs/phase-<N>-<track>.md first.
The contract at contracts/openapi.yaml is the source of truth.
Implement the tasks for this phase only. Don't touch other feature folders.
Stop at the phase checkpoint, run tests, commit with conventional commits, push.
```

---

## 7. Phase-by-Phase Breakdown

### PHASE 0 — Foundation (sequential, ~4h, 1 session)

**Branch:** `main` directly (bootstrap)
**Must finish before anything else starts.**

#### Tasks
- [ ] `git init`, `.gitignore` (Python + Node + Docker + .env)
- [ ] Root `README.md` with quickstart
- [ ] `docker-compose.yml` with services:
  - `db` — `postgis/postgis:16-3.4` with healthcheck
  - `redis` — `redis:7-alpine`
  - `backend` — build from `./backend`, depends_on db+redis
  - `frontend` — build from `./frontend`
  - `mailhog` — local email for dev
- [ ] `database/init/01_extensions.sql` — `CREATE EXTENSION postgis; CREATE EXTENSION pg_trgm;`
- [ ] `.env.example` + `.env` (gitignored) with all keys
- [ ] `backend/pyproject.toml` with base deps
- [ ] `frontend/package.json` via `pnpm create vite`
- [ ] `contracts/` folder with empty `openapi.yaml` stub
- [ ] Root `CLAUDE.md` — project-specific rules (tech stack, commands, conventions)
- [ ] `docs/WORKTREE_PLAYBOOK.md` — the rebase/merge rules
- [ ] `.github/workflows/ci.yml` skeleton (lint + test jobs, matrix for FE/BE)
- [ ] Initial commit: `chore: bootstrap monorepo`

#### Exit criteria
- `docker compose up` boots postgres+redis clean
- `curl localhost:8000/health` returns 200
- `curl localhost:5173` returns Vite splash
- CI pipeline green on empty repo

---

### PHASE 1 — Parallel: Foundations ×3 (~1 day, 3 sessions)

After Phase 0 merge, spawn 3 worktrees simultaneously.

#### Track 1A — Backend skeleton
**Worktree:** `../zerozero-backend-core` on `feature/backend-core`

- FastAPI app factory with lifespan (async engine init/dispose)
- `settings.py` via pydantic-settings reading `.env`
- `core/db.py` — async session dependency
- `core/security.py` — password hash, JWT encode/decode
- `core/deps.py` — `get_current_user`, `require_role`
- Structured logging (`structlog`) — JSON in prod, pretty in dev
- `/health` endpoint returning DB + Redis ping
- Alembic initialized with async template
- CORS, GZip, request-id middleware
- `pytest.ini`, `conftest.py` with async fixtures, testcontainers for Postgres
- Error handler — 422 → nice JSON, 500 → Sentry + generic message

**Exit:** `pytest` green with 1 smoke test, `/health` returns `{db: ok, redis: ok}`

#### Track 1B — Frontend skeleton
**Worktree:** `../zerozero-frontend-core` on `feature/frontend-core`

- Vite + React 19 + TS strict
- Tailwind v4 (via `@tailwindcss/vite`) + `tailwind-merge` + `clsx`
- shadcn CLI init with `neutral` base, OKLCH vars
- Theme engine (`src/features/theme/`):
  - `ThemeProvider` — reads from zustand, writes CSS vars to `:root`
  - `useTheme()` hook returning `{mode, primary, accent, setPrimary, ...}`
  - Preset palettes: `classic-red`, `mint`, `sunset`, `midnight`, `ocean`
  - Mode switch with `prefers-color-scheme` fallback
  - All shadcn components read these vars — no hardcoded colors
- React Router v7 with lazy routes
- TanStack Query client with defaults (staleTime 30s, retry 1)
- `lib/api.ts` — fetch wrapper with auth interceptor, 401 → refresh
- `lib/ws.ts` — reconnecting WS client with exponential backoff
- Zustand stores scaffolded: `auth`, `cart`, `theme`, `location`
- ESLint flat config + Prettier + husky + lint-staged
- `playwright.config.ts` + 1 smoke test

**Exit:** `pnpm dev` shows themed landing page, theme switcher in header works live

#### Track 1C — Database + seed
**Worktree:** `../zerozero-db` on `feature/db-schema`

- All SQLAlchemy models per ERD (section 4)
- `geoalchemy2` types for `location` columns
- Alembic migration: `0001_initial_schema`
- Migration: `0002_indexes_and_fts` (GIST, GIN, trigram)
- Seeder modules:
  - `seed/cuisines.py` — 20 cuisines
  - `seed/categories.py` — 12 categories
  - `seed/restaurants.py` — Faker + 50 restaurants around Delhi NCR coords
  - `seed/menu_items.py` — 10-20 items per restaurant, realistic prices
  - `seed/users.py` — 20 users (5 customers, 5 partners, 10 mixed) with password `test1234`
  - `seed/promos.py` — 5 working promo codes
- CLI: `python -m zerozero_api.seed --reset` drops and re-seeds
- Seed data fixtures in `database/seed-data/*.json` for deterministic test runs

**Exit:** Fresh db + `seed --reset` → data visible in `psql`, `ST_DWithin` query returns neighbors

---

### PHASE 2 — Parallel: Core domains ×3 (~2 days, 3 sessions)

Depends on Phase 1 merged to `main`.

#### Track 2A — Auth
**Worktree:** `feature/auth`

Backend:
- `routers/auth.py` — signup, login, refresh, logout, me
- Password policy (min 8, 1 upper, 1 digit) via pydantic validators
- Rate limit on login via Redis (`slowapi` or custom) — 5/min/IP
- Refresh token rotation, revocation list in Redis
- Optional Google OAuth via `authlib` (toggle by env var)

Frontend:
- `features/auth/`:
  - `LoginPage`, `SignupPage` with shadcn Form + zod
  - `ProtectedRoute` wrapper
  - `useAuth()` hook — login/logout mutations, persisted user
  - Token refresh interceptor in `lib/api.ts`
- Header with user menu (avatar + dropdown)

Tests: Signup → login → access `/me` → refresh → logout

#### Track 2B — Restaurants + Menu
**Worktree:** `feature/restaurants`

Backend:
- `routers/restaurants.py` — list (with geo + filters), detail, menu
- `services/restaurant_service.py` — the big geo query + pagination
- `routers/admin/restaurants.py` — CRUD guarded by role=owner
- Image upload endpoint (local disk in dev, S3-compatible in prod via `boto3` or `minio`)

Frontend:
- `features/restaurants/`:
  - `RestaurantListPage` — grid of `RestaurantCard`, skeleton loaders, infinite scroll
  - `RestaurantDetailPage` — hero image, info, menu categorized with sticky sidebar
  - `MenuItemCard` with variants + add-to-cart button
- `features/admin/` for owner CRUD (hidden unless role=owner)

#### Track 2C — Location services
**Worktree:** `feature/location`

Backend:
- `geo/nominatim.py` — geocoding wrapper (respect rate limit, cache in Redis 24h)
- `routers/geo.py` — `/geocode?q=`, `/reverse?lat=&lng=`
- Extend `/restaurants` to accept `lat,lng` and enforce delivery radius filter

Frontend:
- `features/location/`:
  - `LocationPicker` — address search with autocomplete (debounced 300ms)
  - "Use my location" (Geolocation API + permission UX)
  - `SavedAddresses` list + add/edit/delete
  - Global location state (zustand) — selected address drives all queries
  - Leaflet mini-map showing selected point + delivery coverage circle

**Phase 2 exit:** User can sign up, set address, see realistic nearby restaurants with menus. No ordering yet.

---

### PHASE 3 — Parallel: Commerce ×3 (~2 days, 3 sessions)

#### Track 3A — Cart + Orders
**Worktree:** `feature/orders`

Backend:
- Cart persisted server-side (survives logout/device switch) + client mirror for guests
- `services/order_service.py`:
  - Atomic checkout in transaction
  - Snapshot prices + item names on order (history integrity)
  - Calculate `delivery_fee` by distance, `tax` = 5% demo
  - State machine validations
- `routers/orders.py` + `routers/admin/orders.py` (owner view)

Frontend:
- Cart drawer (Sheet) + full `/cart` page
- Checkout page: address picker, payment method, promo input, order summary
- `OrdersPage` — list + filters (active/past)
- `OrderDetailPage` — status stepper, items, totals, actions

#### Track 3B — Search + Filters
**Worktree:** `feature/search`

Backend:
- `routers/search.py` — unified search across restaurants + items
- tsvector + pg_trgm for fuzzy; typo tolerance via `%` similarity
- Facets response: cuisines with counts, price buckets, rating buckets
- Trending = orders_last_24h sort

Frontend:
- `CommandK` search (shadcn Command palette)
- `/search` page with faceted sidebar, sort dropdown, chips for active filters
- Search suggestions via TanStack Query prefetch on hover

#### Track 3C — Payments + Promos
**Worktree:** `feature/payments`

Backend:
- `services/promo_service.py` — validate eligibility (min order, user limit, date)
- `services/payment_service.py` — mock gateway that always succeeds unless amount ends in `.13` (then fails — for test)
- Webhook endpoint with HMAC verification (signed by mock)
- Wallet: simple ledger table, credits on order cancel

Frontend:
- Payment method selector on checkout (UPI/Card/Wallet — all mock)
- Promo input with live validation feedback
- Success/failure screens with Lottie animations (or CSS anim if no deps)

**Phase 3 exit:** End-to-end order placement works; order sits in "placed" forever (next phase moves it).

---

### PHASE 4 — Parallel: Realtime + Polish ×4 (~3 days, 4 sessions)

#### Track 4A — Realtime order tracking
**Worktree:** `feature/realtime-orders`

Backend:
- `ws/connection_manager.py` — map `order_id → {websockets}`, room pattern
- `ws/orders.py` — WS endpoint, JWT auth on query param, auto-cleanup
- Redis pub/sub: when order status changes, publish to `orders:{id}`; manager forwards
- Admin action (or cron simulator `scripts/order_simulator.py`) advances statuses every N seconds for demo

Frontend:
- `useOrderSocket(orderId)` hook — opens WS, updates TanStack Query cache directly
- `OrderStatusStepper` — animated progress stepper (shadcn Progress + custom)
- Toast on status change
- Reconnect indicator in corner

#### Track 4B — Live location sharing
**Worktree:** `feature/live-location`

Backend:
- `routers/partner.py` — batch location upload (max 10 points)
- Store in `partner_locations`, keep last 1h
- Publish to Redis `partner:{id}:location` and `orders:{order_id}:partner_location`
- `routers/public.py` — share token generation, public tracking endpoint (no auth)

Frontend:
- `PartnerSimulator` dev tool (`/dev/partner`) — geolocation watcher that pushes every 3s (behind a dev flag)
- `LiveMap` component — Leaflet with 2 markers (restaurant, partner) + polyline trail
- ETA calculation (Haversine / speed from last 5 points)
- "Share tracking" button → shareable `/track/:token` public page

#### Track 4C — Reviews + Notifications
**Worktree:** `feature/reviews`

Backend:
- Review creation only after order delivered, one per order (DB unique constraint)
- Aggregate recompute via trigger or service call
- Notifications table + endpoints; WS notifications channel

Frontend:
- Review modal post-delivery
- `/orders/:id` review section
- Notification bell with unread count + dropdown list
- Toast-based real-time notifications

#### Track 4D — Theme customizer
**Worktree:** `feature/theming`

Frontend-only (no backend changes needed; persist per-user optionally via `/users/me/theme`)
- `ThemeCustomizerPanel` — Sheet on right
  - Color pickers for primary + accent (react-colorful)
  - Live preview as user drags
  - Auto-contrast check (WCAG AA) with warning if fails
  - Preset grid (5 palettes, one-click apply)
  - Radius slider (sm/md/lg)
  - Mode toggle (light/dark/system)
  - Export/import theme JSON
- Settings page with "Reset to default"

**Phase 4 exit:** Fully functional app. Place order → watch status → see partner move → get notified → review → customize theme. This is MVP.

---

### PHASE 5 — Integration + Hardening (~2 days, 1-2 sessions)

- Merge all phase-4 branches into `develop`, resolve conflicts
- E2E Playwright suite:
  - Golden path: signup → set address → search → add to cart → checkout → track → review
  - Partner simulator → live location visible to customer
  - Theme customizer persists across reload
- k6 load test: 100 concurrent WS + 500 req/s on search
- Lighthouse: target 90+ performance, 100 a11y on list + detail pages
- Accessibility pass: keyboard nav, focus rings, aria labels, screen-reader on cart
- i18n scaffolding (English only for now, but strings in `en.json`)
- Fix all console warnings, unused deps, dead code
- Bundle analysis: `vite-bundle-visualizer`, split vendor

**Exit:** All tests green, Lighthouse ≥ 90, no errors in 5-min soak test

---

### PHASE 6 — Deploy (~1 day, 1 session)

- Multi-stage Dockerfiles for backend + frontend (nginx serve)
- `docker-compose.prod.yml` with Caddy reverse proxy + automatic HTTPS
- GitHub Actions:
  - PR: lint + test + build
  - `main` push: build + push images to GHCR
  - Manual dispatch: deploy to VPS via SSH
- Sentry DSN, OpenTelemetry collector
- Backup cron for Postgres (`pg_dump` nightly to S3)
- README with architecture diagram, deploy runbook, troubleshooting

**Exit:** `https://zerozero.<domain>` live, CI auto-deploys, errors tracked

---

## 8. Integration Checkpoints (hard gates)

| Checkpoint | Gate |
|---|---|
| End of Phase 0 | `docker compose up` healthy, CI green |
| End of Phase 1 | Backend+frontend skeletons independently run, seed populates real data |
| End of Phase 2 | Logged-in user sees real restaurants for their address |
| End of Phase 3 | Order can be placed end-to-end, shows in history |
| End of Phase 4 | Real-time tracking + theme customization both visibly working |
| End of Phase 5 | Lighthouse 90+, E2E green, no console errors |
| End of Phase 6 | Public URL live, CI deploys on push |

Skip a checkpoint at your peril — debt compounds.

---

## 9. Testing Strategy (per phase)

- **Backend:** `pytest` — unit (services), integration (routers with testcontainers Postgres), WS tests with `httpx-ws`
- **Frontend:** `vitest` — hooks + utils; Testing Library for components; mock Service Worker (`msw`) for API
- **E2E:** `playwright` — golden paths only, runs in CI on Phase 5+
- **No mocks in integration tests** (per global CLAUDE.md feedback memory) — use testcontainers for real Postgres
- **Every phase ends with tests green** before merging

---

## 10. Parallel Session Playbook

```
Morning:
  1. cd ~/zerozero && git fetch && git checkout main && git pull
  2. For each active worktree:
       cd ../zerozero-<feature>
       git fetch origin
       git rebase origin/main
       resolve conflicts (db migrations, contract)
  3. Spawn N Claude Code sessions, one per worktree
  4. Each session reads CLAUDE.md + docs/MASTER_PLAN.md + phase doc

Midday sync (15 min):
  - Share blockers in notes
  - Lead dev merges completed sub-tasks to main
  - Everyone rebases

EOD:
  - Each session: run tests, commit with conventional message, push branch
  - Open draft PR for visibility
  - Update phase checklist in this doc (tick boxes)

Merge order at phase end:
  1. DB migrations (always first, sequential)
  2. Backend routers/services
  3. Frontend features
  4. Tests
```

---

## 11. Risk Register

| Risk | Mitigation |
|---|---|
| PostGIS learning curve | `geoalchemy2` examples in Phase 1C; pair query review |
| WebSocket scaling beyond 1 box | Redis pub/sub from day 1, sticky sessions via Caddy |
| Nominatim rate limit | Cache all geocodes 24h in Redis; fallback to Photon |
| Theme CSS vars conflict with shadcn | Use OKLCH + shadcn v2.1+ tokens only |
| Parallel branches diverge on types | Generate TS from OpenAPI nightly in CI |
| Alembic migration collisions | Only phase lead creates migrations; use timestamp prefixes |
| Real-time + mobile battery | Throttle partner pings to 3s + pause when tab hidden |

---

## 12. Definition of Done (entire project)

- [ ] User can complete the full loop: signup → address → order → track → review
- [ ] Delivery partner simulator drives a visible moving marker on the customer's map
- [ ] Share link works in incognito (no auth) and shows same live map
- [ ] Theme customizer changes every colored pixel app-wide, persists across sessions
- [ ] 50+ realistic restaurants visible on fresh seed
- [ ] All tests green in CI; Lighthouse ≥ 90 on 3 key pages
- [ ] Deployed to public URL with HTTPS
- [ ] README walkthrough anyone can follow to run locally in < 5 minutes

---

## 13. Next Immediate Action

**You (Rajat) decide:**
1. **Path A — "Bhai shuru kar de":** I start Phase 0 now (bootstrap monorepo, docker-compose, CLAUDE.md). ~45 min.
2. **Path B — Refine plan first:** Tell me what to change — add/remove features, different tech, scope smaller MVP, etc.
3. **Path C — Only docs first:** I write all supporting docs (`ERD.md`, `API.md`, `WORKTREE_PLAYBOOK.md`, `THEMING.md`) before touching code.

Default recommendation: **Path A**, because Phase 0 is low-risk scaffolding and it unlocks all parallel tracks. I'll pause at the Phase 0 exit checkpoint for your review before opening parallel worktrees.

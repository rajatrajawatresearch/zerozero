# Worktree & Parallel Agent Playbook

## Current phase file-ownership map

Each phase below lists 10 agents and their exclusive file paths. No agent may create or modify files outside its list. Shared files (e.g., `package.json`, `pyproject.toml`, Alembic migrations) have a single "lead" agent per phase.

---

## Phase 1 — Foundations (10 parallel agents)

| # | Agent Role | Exclusive Paths | Notes |
|---|---|---|---|
| 1 | BE-App-Shell | `backend/src/zerozero_api/{__init__.py,main.py,settings.py}` | FastAPI factory, lifespan, settings |
| 2 | BE-Core-DB | `backend/src/zerozero_api/core/{__init__.py,db.py}` + `backend/alembic.ini` + `backend/alembic/{env.py,script.py.mako}` | **Lead for Alembic config** |
| 3 | BE-Security | `backend/src/zerozero_api/core/{security.py,deps.py,ratelimit.py}` | JWT, argon2, rate-limit deps |
| 4 | BE-Observability | `backend/src/zerozero_api/core/{logging.py,middleware.py,errors.py}` + `backend/src/zerozero_api/routers/health.py` | structlog, request-id, exception handlers |
| 5 | BE-Tests | `backend/tests/*` + `backend/conftest.py` | pytest config, testcontainers fixtures, smoke tests |
| 6 | BE-Domain-Models | `backend/src/zerozero_api/domain/*.py` + `backend/alembic/versions/0001_*.py` | **Lead for initial migration** |
| 7 | BE-Seed | `backend/src/zerozero_api/seed/*.py` + `database/seed-data/*.json` | Faker-based seeders |
| 8 | FE-App-Shell | `frontend/{vite.config.ts,tsconfig*.json,index.html,eslint.config.js,.prettierrc,postcss.config.js,playwright.config.ts,vitest.config.ts}` + `frontend/src/{main.tsx,index.css,App.tsx,vite-env.d.ts}` | Vite + TS + Tailwind v4 config |
| 9 | FE-Theme-UI | `frontend/src/components/ui/*.tsx` + `frontend/src/features/theme/*` + `frontend/src/styles/theme.css` + `frontend/components.json` | shadcn primitives + OKLCH theme engine |
| 10 | FE-State-Router | `frontend/src/{app,store,lib,features/routes.ts}/**` + `frontend/src/features/_placeholder/*` | Router, TanStack Query, Zustand, api+ws clients |

### Coordination rules for Phase 1
- Agent 2 is **Alembic lead** — only agent 2 touches alembic.ini and env.py
- Agent 6 creates the initial migration (0001), stamps it with `0001_initial_schema`
- Agents 8, 9, 10 all write in `frontend/src/` but in disjoint subfolders — no file overlap
- Agent 8 owns `package.json` updates; other agents list needed deps in their PR description, agent 8 merges last

---

## Phase 2 — Core Domains (10 parallel agents)

| # | Agent Role | Exclusive Paths |
|---|---|---|
| 1 | BE-Auth-API | `backend/src/zerozero_api/routers/auth.py` + `services/auth_service.py` + `schemas/auth.py` |
| 2 | BE-Auth-Tests | `backend/tests/test_auth*.py` |
| 3 | BE-Restaurants-API | `backend/src/zerozero_api/routers/restaurants.py` + `services/restaurant_service.py` + `schemas/restaurant.py` |
| 4 | BE-Restaurants-Admin | `backend/src/zerozero_api/routers/admin/restaurants.py` + `services/admin_restaurant_service.py` |
| 5 | BE-Location | `backend/src/zerozero_api/routers/geo.py` + `geo/*.py` + `schemas/geo.py` |
| 6 | BE-Upload | `backend/src/zerozero_api/routers/uploads.py` + `services/storage.py` |
| 7 | FE-Auth | `frontend/src/features/auth/**` |
| 8 | FE-Restaurants | `frontend/src/features/restaurants/**` |
| 9 | FE-Location | `frontend/src/features/location/**` |
| 10 | FE-Layout | `frontend/src/components/layout/**` + `frontend/src/features/home/**` |

---

## Phase 3 — Commerce (10 parallel agents)
| # | Agent Role | Exclusive Paths |
|---|---|---|
| 1 | BE-Cart | `routers/cart.py`, `services/cart_service.py`, `schemas/cart.py` |
| 2 | BE-Orders | `routers/orders.py`, `services/order_service.py`, `schemas/order.py`, migration `0002_orders` |
| 3 | BE-Search | `routers/search.py`, `services/search_service.py` |
| 4 | BE-Payments | `routers/payments.py`, `services/payment_service.py`, `schemas/payment.py` |
| 5 | BE-Promos | `services/promo_service.py`, `schemas/promo.py` |
| 6 | BE-Commerce-Tests | `tests/test_{cart,orders,search,payments,promos}*.py` |
| 7 | FE-Cart | `features/cart/**` |
| 8 | FE-Checkout | `features/checkout/**` |
| 9 | FE-Orders | `features/orders/**` |
| 10 | FE-Search | `features/search/**` |

---

## Phase 4 — Realtime + Polish (10 parallel agents)
| # | Agent Role | Exclusive Paths |
|---|---|---|
| 1 | BE-WS-Orders | `ws/connection_manager.py`, `ws/orders.py` |
| 2 | BE-WS-Partner | `ws/partner.py`, `routers/partner.py` |
| 3 | BE-WS-Public | `ws/public.py`, `routers/public.py` |
| 4 | BE-Reviews | `routers/reviews.py`, `services/review_service.py`, migration `0003_reviews` |
| 5 | BE-Notifications | `routers/notifications.py`, `services/notification_service.py` |
| 6 | BE-RT-Tests | `tests/test_ws_*.py`, `tests/test_reviews*.py` |
| 7 | FE-Tracking | `features/tracking/**` |
| 8 | FE-Partner-Sim | `features/partner-sim/**` |
| 9 | FE-Theme-Customizer | `features/theme-customizer/**` |
| 10 | FE-Reviews-Notif | `features/reviews/**`, `features/notifications/**` |

---

## Phase 5 — Integration (3-4 agents)
- Agent 1: Playwright E2E golden paths
- Agent 2: k6 load tests + Lighthouse CI
- Agent 3: Accessibility audit + fixes
- Agent 4: Dead code + bundle analysis

---

## Phase 6 — Deploy (3 agents)
- Agent 1: Multi-stage Dockerfiles + prod compose + Caddy
- Agent 2: GitHub Actions deploy workflow
- Agent 3: Sentry + OpenTelemetry + docs/runbook

---

## Git workflow

Currently using a **single repo without worktrees** for simplicity — 10 agents write to disjoint paths in the same working directory. If merge conflicts start to surface, switch to:

```bash
# per phase, after main is clean:
for agent in 1 2 3 4 5 6 7 8 9 10; do
  git worktree add "../zerozero-ph${PHASE}-a${agent}" "feature/ph${PHASE}-a${agent}"
done
```

## Recheck protocol

After every phase completes, spawn **1-2 review agents** with these prompts:
1. **feature-dev:code-reviewer** — "Review files changed in phase N. Report only HIGH-confidence issues: bugs, security holes, contract violations, style breaks from CLAUDE.md."
2. **feature-dev:code-explorer** — "Verify the exit criteria of phase N from MASTER_PLAN.md are met. Check imports, run tests in your head, flag orphan code."

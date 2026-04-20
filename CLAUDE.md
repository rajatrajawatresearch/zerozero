# ZeroZero — Project Rules for Claude Code

## Identity
You are working on **ZeroZero**, a Zomato-style food-delivery clone.
Full master plan lives at `docs/MASTER_PLAN.md` — read it before coding.

## Tech Stack (authoritative)
- **Backend:** Python 3.12 + FastAPI 0.115 + SQLAlchemy 2.0 async + Alembic + Pydantic v2 + structlog
- **DB:** PostgreSQL 16 + PostGIS 3.4 + pg_trgm
- **Cache / PubSub:** Redis 7
- **Frontend:** React 19 + Vite 6 + TypeScript 5 (strict) + Tailwind CSS v4 + shadcn/ui
- **State:** TanStack Query v5 (server) + Zustand (client) + react-hook-form + zod
- **Maps:** Leaflet + react-leaflet + OpenStreetMap tiles
- **Tests:** pytest + testcontainers (backend), Vitest + Testing Library + Playwright (frontend)

## Commands

### Dev
```bash
docker compose up              # full stack
docker compose up db redis     # infra only
```

### Backend (from ./backend)
```bash
uv sync                        # install deps (uv preferred over pip)
uv run uvicorn zerozero_api.main:app --reload --port 8000
uv run pytest
uv run alembic revision --autogenerate -m "msg"
uv run alembic upgrade head
uv run python -m zerozero_api.seed --reset
uv run ruff check . && uv run ruff format .
uv run mypy src
```

### Frontend (from ./frontend)
```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm test:e2e
pnpm lint
pnpm typecheck
```

## File Ownership (during parallel agent work)

When multiple agents work in parallel on this repo, each agent MUST stay in its assigned file paths. See `docs/WORKTREE_PLAYBOOK.md` for current phase ownership map. Do NOT edit files outside your assigned paths.

## Hard Rules

1. **No mocks in integration tests.** Use `testcontainers` for real Postgres. Reason: prod migrations break when tests pass against mocks.
2. **Type-safe always.** Strict TS, full Python type hints, Pydantic v2 models for all DTOs.
3. **Contract-first.** `contracts/openapi.yaml` is the source of truth between frontend and backend. Update it before changing API shape.
4. **One Alembic migration author per phase.** Coordinate via `docs/WORKTREE_PLAYBOOK.md`. Stamp migrations with timestamp prefix.
5. **PostGIS columns use `geoalchemy2.Geography(geometry_type='POINT', srid=4326)`.** Always. Don't use raw `ST_*` in Python — use `geoalchemy2.functions`.
6. **Money = integer cents.** Never float for prices. Column type `Numeric(12, 2)` or `Integer` cents — pick one and document.
7. **Timestamps are UTC + timezone-aware.** `DateTime(timezone=True)` + `server_default=func.now()`.
8. **No hardcoded colors in components.** Only OKLCH CSS variables from the theme system.
9. **Every new file must be imported somewhere.** No orphan code.
10. **Real-time state flows through TanStack Query cache,** not separate stores. WS updates call `queryClient.setQueryData`.

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`)
- **Branches:** `feature/<phase-track-name>` e.g. `feature/auth`, `feature/realtime-orders`
- **PRs:** Link to phase checkpoint in `docs/MASTER_PLAN.md`, tick exit-criteria boxes
- **API routes:** plural nouns (`/restaurants`, `/orders`), kebab-case URLs, camelCase in JSON
- **Python:** snake_case everywhere, `from __future__ import annotations` at top
- **React:** PascalCase components, camelCase hooks (`useXxx`), one component per file
- **Folder scheme (frontend):** feature-sliced (`features/<domain>/{api,components,hooks,types,index.ts}`)
- **Folder scheme (backend):** domain-driven (`routers/` = HTTP, `services/` = business, `domain/` = SQLAlchemy models)

## Codebase Intelligence Protocol

Before editing any file:
1. Read the full file (not just surrounding area)
2. Check callers + tests + config that reference it
3. Search for existing patterns — follow them
4. Find the type definitions first

## Response Style
- Respond in Hinglish
- Lead with action, not explanation
- Be concise but complete

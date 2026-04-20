# ZeroZero

Zomato-style food delivery clone — real-time order tracking, live location sharing, dynamic theming.

## Stack
React 19 + FastAPI + PostgreSQL/PostGIS + Redis + WebSockets + shadcn/ui

## Quick start

```bash
# 1. Clone + env
cp .env.example .env

# 2. Boot infra + apps
docker compose up --build

# 3. Seed demo data (in another terminal)
docker compose exec backend python -m zerozero_api.seed --reset

# 4. Visit
open http://localhost:5173        # frontend
open http://localhost:8000/docs   # API (Swagger)
open http://localhost:8025        # Mailhog (dev emails)
```

Demo users (after seed):
- `customer@test.com` / `test1234`
- `partner@test.com` / `test1234` (delivery partner)
- `owner@test.com` / `test1234` (restaurant owner)

## Architecture

See `docs/MASTER_PLAN.md` for the full implementation plan and phase breakdown.

```
┌─────────────┐      HTTPS       ┌──────────────┐      asyncpg      ┌──────────────┐
│  Frontend   │  ─────────────►  │   FastAPI    │  ───────────────► │  Postgres+   │
│  React 19   │  ◄─────────────  │   Backend    │  ◄─────────────── │   PostGIS    │
└──────┬──────┘        JSON      └──────┬───────┘                   └──────────────┘
       │                                │
       │          WebSocket             │     pub/sub        ┌──────────────┐
       └────────────────────────────────┼───────────────────►│    Redis     │
                                        │                    └──────────────┘
```

## Development

See `CLAUDE.md` for project rules, `docs/WORKTREE_PLAYBOOK.md` for parallel-agent coordination.

# ZeroZero — Deploy Runbook

Production deploy uses **Docker Compose + Caddy** (auto-TLS via Let's Encrypt) on a single VPS. Stack: `db (postgis) → redis → backend (FastAPI) → frontend (Caddy-served SPA) → caddy (reverse proxy + TLS)`.

---

## 1. Prerequisites

| Need | Minimum |
|---|---|
| VPS | 2 vCPU, 4 GB RAM, 40 GB SSD (Ubuntu 22.04+ or Debian 12+) |
| Docker | 24.x with Compose V2 (`docker compose version`) |
| DNS | A/AAAA record for `DOMAIN` pointing at the VPS IPv4/IPv6 |
| Firewall | Ports **80** and **443** inbound open (22 for SSH) |
| Repo access | SSH deploy key or HTTPS token for cloning |

Quick install on a fresh Ubuntu box:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
```

Make sure `DOMAIN` actually resolves before bringing the stack up — Caddy's ACME challenge will fail otherwise.

---

## 2. First Deploy

```bash
# 1. Clone on the VPS
git clone git@github.com:YOUR_ORG/zerozero.git /opt/zerozero
cd /opt/zerozero

# 2. Configure secrets
cp .env.production.example .env
$EDITOR .env     # Fill DOMAIN, POSTGRES_PASSWORD, JWT_SECRET, SENTRY_DSN, SMTP_*, VITE_*

# Generate strong secrets:
#   JWT_SECRET:           openssl rand -hex 64
#   POSTGRES_PASSWORD:    openssl rand -base64 32

# 3. Build + start the stack (detached)
docker compose -f docker-compose.prod.yml up -d --build

# 4. Run DB migrations (first boot only)
docker compose -f docker-compose.prod.yml exec backend \
  python -m alembic upgrade head

# 5. (Optional) Seed demo data
docker compose -f docker-compose.prod.yml exec backend \
  python -m zerozero_api.seed --reset

# 6. Verify
curl -I https://$DOMAIN/api/health
docker compose -f docker-compose.prod.yml ps
```

Caddy will provision a Let's Encrypt cert automatically on first request to `https://$DOMAIN`. Watch it with `docker compose -f docker-compose.prod.yml logs -f caddy`.

---

## 3. Subsequent Deploys

```bash
cd /opt/zerozero
git pull origin main
docker compose -f docker-compose.prod.yml build backend frontend
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec backend \
  python -m alembic upgrade head
```

CI (`.github/workflows/deploy.yml`, Agent D2) automates this via SSH + GHCR image pull.

---

## 4. Migrations & Seed Data

- **Migrations** run with Alembic inside the backend container. Always `upgrade head` **after** new images are up.
- **Rollback a migration:** `docker compose -f docker-compose.prod.yml exec backend python -m alembic downgrade -1`
- **Seed reset** (destructive — wipes data): `docker compose -f docker-compose.prod.yml exec backend python -m zerozero_api.seed --reset`

---

## 5. Rollback

The previous image is tagged in GHCR on every deploy. To roll back:

```bash
# Set the previous tag (e.g. the SHA or semver tag you want)
export IMAGE_TAG=<previous-tag>

# Pull + recreate only app services, leave db/redis untouched
docker compose -f docker-compose.prod.yml pull backend frontend
docker compose -f docker-compose.prod.yml up -d --force-recreate backend frontend

# If the rollback target predates a DB migration:
docker compose -f docker-compose.prod.yml exec backend \
  python -m alembic downgrade <revision-id>
```

For a local-built fallback when GHCR is down, `git checkout <last-good-sha> && docker compose -f docker-compose.prod.yml up -d --build` works too.

---

## 6. TLS / SSL

Caddy handles HTTPS entirely. Requirements:

1. `DOMAIN` env var set in `.env`
2. DNS A record pointing at the VPS
3. Ports **80** and **443** reachable from the public internet (ACME HTTP-01 challenge uses 80; traffic afterwards uses 443)
4. Valid `ACME_EMAIL` in `.env` for expiry notifications

Certs auto-renew ~30 days before expiry. Persisted in the `caddy_data` named volume — **do not delete it**.

Force a cert re-issue (rare):

```bash
docker compose -f docker-compose.prod.yml exec caddy \
  caddy reload --config /etc/caddy/Caddyfile
```

---

## 7. Backups

```bash
# DB dump (run via cron on the host)
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > \
  /var/backups/zerozero/db-$(date +%F).sql.gz

# Uploaded media
docker run --rm -v zerozero_uploads_data:/data -v /var/backups/zerozero:/backup \
  alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Restore: `gunzip -c db-YYYY-MM-DD.sql.gz | docker compose exec -T db psql -U $POSTGRES_USER -d $POSTGRES_DB`.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `502 Bad Gateway` from Caddy | `docker compose logs backend` / `frontend` — container probably crashed or still booting. |
| Caddy stuck issuing cert | Check `DOMAIN` DNS + that 80/443 are open. Rate-limited? Wait 1h or use staging ACME. |
| `FATAL: password authentication failed` | `POSTGRES_PASSWORD` mismatch between `.env` and the `db_data` volume. Either fix the password or wipe the volume (destroys data). |
| Migrations hang | Long-running query lock. `docker compose exec db psql -U $POSTGRES_USER -c "SELECT * FROM pg_stat_activity WHERE state='active';"` |
| Out of disk | Prune: `docker system prune -af --volumes` (be careful — check named volumes first). |

Log streams:

```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f caddy
docker compose -f docker-compose.prod.yml logs -f --tail=200
```

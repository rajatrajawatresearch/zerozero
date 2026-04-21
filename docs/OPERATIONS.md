# ZeroZero — Operations Runbook

Oncall runbook for production. Keep tab open during on-call shift.

**Prod host**: `/srv/zerozero` on the VPS
**Compose file**: `docker-compose.prod.yml`
**Health endpoints**: `GET /api/v1/health` (app-level), `GET /healthz` (liveness, no DB)
**Deploy workflow**: `.github/workflows/deploy.yml`

---

## 1. Incident: Backend 5xx spike

**Symptom**: Sentry alert fires OR Grafana error-rate panel > 1% OR user reports.

### Step 1 — Triage (first 2 minutes)

```bash
# SSH to VPS
ssh deploy@$VPS_HOST
cd /srv/zerozero

# Is the backend even up?
docker compose -f docker-compose.prod.yml ps backend

# Liveness probe (no DB/Redis dependency)
curl -fsS http://localhost:8000/healthz && echo OK

# Full health (touches DB + Redis)
curl -fsS http://localhost:8000/api/v1/health | jq .
```

### Step 2 — Check dependencies

```bash
# Postgres
docker compose -f docker-compose.prod.yml exec db pg_isready -U zerozero
docker compose -f docker-compose.prod.yml exec db psql -U zerozero -d zerozero -c \
  "SELECT count(*) AS active FROM pg_stat_activity WHERE state='active';"

# Redis
docker compose -f docker-compose.prod.yml exec redis redis-cli PING
docker compose -f docker-compose.prod.yml exec redis redis-cli INFO clients | grep connected_clients
```

Green here means the app is the problem. Red means dependency is the problem — skip to section 2 or 3.

### Step 3 — Tail logs

```bash
# Last 5 min, only errors/warnings
docker compose -f docker-compose.prod.yml logs --since 5m backend \
  | jq -r 'select(.level=="error" or .level=="warning") | "\(.timestamp) \(.event) \(.request_id // "") \(.exception // "")"' \
  | head -50

# Live tail
docker compose -f docker-compose.prod.yml logs -f --tail=100 backend
```

Grab a `request_id` from a representative error and search Sentry — full stack trace there.

### Step 4 — Decide

| Finding                                      | Action                                     |
|----------------------------------------------|--------------------------------------------|
| Recent deploy + errors started at deploy time | Rollback (section 4)                       |
| DB pool exhausted                            | Restart backend: `docker compose restart backend` |
| Redis connection errors                      | Section 3                                  |
| Single route failing                          | Check Sentry, patch forward, hotfix deploy |
| Unknown / cascading                          | Rollback first, investigate after         |

---

## 2. Incident: Database issues

### DB unreachable

```bash
docker compose -f docker-compose.prod.yml ps db
docker compose -f docker-compose.prod.yml logs --tail=200 db
docker compose -f docker-compose.prod.yml restart db    # last resort
```

### Slow queries

```bash
docker compose -f docker-compose.prod.yml exec db psql -U zerozero -d zerozero -c \
  "SELECT pid, now()-query_start AS duration, state, substring(query,1,120)
   FROM pg_stat_activity
   WHERE state != 'idle' AND now()-query_start > interval '5 seconds'
   ORDER BY duration DESC;"
```

Kill a runaway query:

```bash
docker compose -f docker-compose.prod.yml exec db psql -U zerozero -d zerozero -c \
  "SELECT pg_cancel_backend(<pid>);"     # polite
docker compose -f docker-compose.prod.yml exec db psql -U zerozero -d zerozero -c \
  "SELECT pg_terminate_backend(<pid>);"  # forceful
```

### Migration failure during deploy

See section 6.

---

## 3. Incident: Redis / WebSocket issues

```bash
# Redis alive?
docker compose -f docker-compose.prod.yml exec redis redis-cli PING

# Pub/sub channel traffic
docker compose -f docker-compose.prod.yml exec redis redis-cli --csv PSUBSCRIBE 'orders:*' &
# ^ watch for messages; Ctrl+C to stop

# Memory pressure
docker compose -f docker-compose.prod.yml exec redis redis-cli INFO memory | grep used_memory_human
```

If Redis is stuck: `docker compose -f docker-compose.prod.yml restart redis`. WS clients will reconnect automatically (frontend has retry with backoff).

---

## 4. Rolling back a deploy

Every image is tagged with the commit SHA (see `.github/workflows/images.yml`). `latest` floats to the newest build.

### Fast rollback (previous SHA)

```bash
# Find the previous good SHA
docker images ghcr.io/<owner>/<repo>-backend --format '{{.Tag}}\t{{.CreatedAt}}' | head

export PREV_SHA=<previous-commit-sha>

# Pin both services in .env on the VPS (used by docker-compose.prod.yml)
cd /srv/zerozero
sed -i.bak "s/^BACKEND_IMAGE_TAG=.*/BACKEND_IMAGE_TAG=${PREV_SHA}/"   .env
sed -i.bak "s/^FRONTEND_IMAGE_TAG=.*/FRONTEND_IMAGE_TAG=${PREV_SHA}/" .env

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --no-build

# Verify
curl -fsS https://$DOMAIN/api/v1/health | jq .
```

### One-shot rollback of just the backend

```bash
docker compose -f docker-compose.prod.yml up -d --no-build \
  backend=ghcr.io/<owner>/<repo>-backend:${PREV_SHA}
```

### Migration rollback

Alembic migrations are forward-only by convention. If a new migration is actively harming prod, roll the DB back manually:

```bash
docker compose -f docker-compose.prod.yml exec backend alembic downgrade -1
```

Caveat: only safe if the migration is reversible AND no new rows depend on the new schema. Otherwise restore from backup (section 7).

### Post-rollback checklist

- [ ] Health endpoint returns 200
- [ ] Sentry error rate returning to baseline
- [ ] Pin the bad SHA in a post-mortem ticket
- [ ] Open a revert PR against main so `latest` won't re-ship the bad build

---

## 5. Routine deploy

Triggered automatically by `.github/workflows/deploy.yml` on every successful `images.yml` run on `main`. Manual trigger:

1. GitHub → Actions → "Deploy to VPS" → "Run workflow"
2. Watch the job logs; the health check step must pass

Manual deploy from VPS (only if Actions is broken):

```bash
ssh deploy@$VPS_HOST
cd /srv/zerozero
git pull --ff-only
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --no-build
docker compose -f docker-compose.prod.yml exec -T backend alembic upgrade head
curl -fsS https://$DOMAIN/api/v1/health | jq .
```

---

## 6. Adding a migration to prod

Writing a migration is the dev's job; applying it is ops.

### Checklist for the author

- [ ] Migration is idempotent (guards `IF NOT EXISTS` where safe)
- [ ] Migration is backward-compatible for at least one deploy cycle (add column nullable → backfill → make required in next release)
- [ ] Heavy migrations (table rewrite, big index) have been benchmarked against a prod-sized DB copy
- [ ] A rollback path is documented in the migration's docstring

### Applying

The deploy workflow runs `alembic upgrade head` automatically. To apply manually:

```bash
ssh deploy@$VPS_HOST
cd /srv/zerozero
docker compose -f docker-compose.prod.yml exec -T backend alembic current
docker compose -f docker-compose.prod.yml exec -T backend alembic upgrade head
docker compose -f docker-compose.prod.yml exec -T backend alembic current   # verify
```

### If migration fails mid-way

```bash
# See what partial state we're in
docker compose -f docker-compose.prod.yml exec backend alembic current

# Fix the migration file, push, redeploy — OR manually heal:
docker compose -f docker-compose.prod.yml exec db psql -U zerozero -d zerozero
# ... manually undo the partial change, then:
docker compose -f docker-compose.prod.yml exec backend alembic stamp <previous-revision>
```

Never leave a prod DB in mixed state — either fully upgraded or fully reverted to a known revision.

---

## 7. Backups

### Daily dump to S3 (cron on the VPS)

Add to `/etc/cron.d/zerozero-backup`:

```cron
# /etc/cron.d/zerozero-backup — daily pg_dump to S3
MAILTO=oncall@zerozero.example
0 2 * * * deploy /usr/local/bin/zerozero-backup.sh >> /var/log/zerozero-backup.log 2>&1
```

`/usr/local/bin/zerozero-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

TS=$(date -u +%Y%m%dT%H%M%SZ)
DUMP=/tmp/zerozero-${TS}.sql.gz
BUCKET=s3://zerozero-backups/postgres
RETAIN_DAYS=30

cd /srv/zerozero
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U zerozero -d zerozero --no-owner --format=plain \
  | gzip -9 > "${DUMP}"

aws s3 cp "${DUMP}" "${BUCKET}/zerozero-${TS}.sql.gz" \
  --storage-class STANDARD_IA \
  --sse AES256

rm -f "${DUMP}"

# Retain last 30 days; older than that, move to Glacier
aws s3 ls "${BUCKET}/" | awk '{print $4}' | while read -r f; do
  [ -z "$f" ] && continue
  age_days=$(( ( $(date -u +%s) - $(date -u -d "$(echo $f | sed -E 's/zerozero-([0-9]{8})T.*/\1/;s/(....)(..)(..)/\1-\2-\3/')" +%s) ) / 86400 ))
  if [ "$age_days" -gt "$RETAIN_DAYS" ]; then
    aws s3 mv "${BUCKET}/${f}" "${BUCKET}/archive/${f}" --storage-class GLACIER
  fi
done

echo "backup ok: ${BUCKET}/zerozero-${TS}.sql.gz"
```

Make executable: `chmod +x /usr/local/bin/zerozero-backup.sh`.
AWS creds: in `/root/.aws/credentials` with minimum IAM `s3:PutObject` + `s3:ListBucket` + `s3:GetObject` on the bucket.

### Restoring

```bash
aws s3 cp s3://zerozero-backups/postgres/zerozero-YYYYMMDDTHHMMSSZ.sql.gz /tmp/restore.sql.gz
gunzip /tmp/restore.sql.gz

# STOP the app first so no writes race the restore
docker compose -f docker-compose.prod.yml stop backend

docker compose -f docker-compose.prod.yml exec -T db psql -U zerozero -d postgres -c \
  "DROP DATABASE IF EXISTS zerozero; CREATE DATABASE zerozero OWNER zerozero;"

cat /tmp/restore.sql | docker compose -f docker-compose.prod.yml exec -T db \
  psql -U zerozero -d zerozero

docker compose -f docker-compose.prod.yml up -d backend
```

### Verify backup freshness (weekly)

```bash
aws s3 ls s3://zerozero-backups/postgres/ | tail -7
# Expect 7 files, one per day, each > 5 MB
```

---

## 8. Contacts & escalation

- **Primary oncall**: rotation in PagerDuty
- **Secondary**: engineering lead
- **Vendor contacts**: Sentry support, VPS provider support, domain registrar
- **After-hours sev-1**: page primary → 10 min no-ack → page secondary

Update this list quarterly.

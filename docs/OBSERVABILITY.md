# ZeroZero — Observability

Scope: error reporting, structured logging, metrics, dashboards. Agent D2 owns this doc.

---

## 1. Error reporting (Sentry)

Backend (FastAPI) and frontend (React) both ship to Sentry.

### Configure DSN

Add to `.env.production` (on the VPS, next to `docker-compose.prod.yml`):

```bash
# Backend
SENTRY_DSN=https://<public-key>@o<org>.ingest.sentry.io/<project>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1        # 10% of transactions
SENTRY_PROFILES_SAMPLE_RATE=0.1

# Frontend (baked at build time as VITE_*)
VITE_SENTRY_DSN=https://<public-key>@o<org>.ingest.sentry.io/<project>
VITE_SENTRY_ENVIRONMENT=production
```

Frontend env vars are embedded during `pnpm build`, so rebuilding the image is required after rotating the DSN. Backend reads DSN at process start — a container restart suffices.

### What gets captured

- Unhandled exceptions (FastAPI default handler + React ErrorBoundary)
- Any response with status `>= 500` returned from a route handler
- Explicit `sentry_sdk.capture_exception(e)` calls in `except:` blocks where the app swallows the error but wants to log it
- Frontend: unhandled promise rejections, React render errors, any `Sentry.captureException` call in network-error handlers

The following are NOT sent to Sentry (by design):

- 4xx responses (validation, auth) — noisy, low-signal
- HTTPException raised intentionally by business logic
- WebSocket disconnects with code 1000/1001 (client went away)

### Verify after deploy

1. Open Sentry project → Issues tab
2. Hit a deliberately broken endpoint: `curl https://$DOMAIN/api/v1/_debug/boom` (only enabled if `APP_ENV != production` — so test on staging)
3. For prod verification, raise a zero-impact test event from a shell on the VPS:

```bash
docker compose exec backend python -c \
  "import sentry_sdk; sentry_sdk.init('$SENTRY_DSN', environment='production'); sentry_sdk.capture_message('deploy smoke-test', level='info')"
```

4. Event should appear in Sentry within ~15 seconds. Delete or resolve it after verification.

---

## 2. Structured logging (structlog)

All backend log lines are structured. Format depends on `APP_ENV`:

| `APP_ENV`       | Renderer                                         |
|-----------------|--------------------------------------------------|
| `development`   | `ConsoleRenderer` — human-readable, colorized    |
| `test`          | `ConsoleRenderer` — same as dev, deterministic   |
| `production`    | `JSONRenderer` — one JSON object per line        |

In production, every log line looks like:

```json
{"event":"order.placed","level":"info","timestamp":"2026-04-21T10:12:34.567Z","request_id":"01JK...","user_id":"usr_123","order_id":"ord_456","total_cents":54900}
```

Mandatory fields injected by middleware: `timestamp`, `level`, `event`, `request_id`. Everything else is per-call context via `structlog.contextvars.bind_contextvars(...)`.

### Log shipping

Docker captures stdout/stderr. Pick one of the following shippers and configure the Docker logging driver in `docker-compose.prod.yml` (Agent D1 owns that file; coordinate before enabling).

#### Option A — Loki (recommended, self-hosted)

```yaml
# in docker-compose.prod.yml
services:
  backend:
    logging:
      driver: loki
      options:
        loki-url: "http://loki.internal:3100/loki/api/v1/push"
        loki-retries: "3"
        loki-batch-size: "400"
        labels: "service=zerozero-backend,env=production"
```

LogQL queries to pin in Grafana:

```logql
# 5xx rate per minute
sum(rate({service="zerozero-backend"} | json | level="error" [1m]))

# Slow requests
{service="zerozero-backend"} | json | duration_ms > 500
```

#### Option B — Datadog (managed)

```yaml
services:
  backend:
    logging:
      driver: "json-file"   # Datadog agent tails the file
      options:
        tag: "zerozero-backend"
    labels:
      com.datadoghq.ad.logs: '[{"source": "python", "service": "zerozero-backend"}]'
```

Run the Datadog agent as a sidecar container with `DD_API_KEY` and `DD_LOGS_ENABLED=true`.

#### Option C — CloudWatch (AWS-native)

```yaml
services:
  backend:
    logging:
      driver: awslogs
      options:
        awslogs-region: ap-south-1
        awslogs-group: /zerozero/backend
        awslogs-create-group: "true"
        awslogs-stream: backend-${HOSTNAME}
```

IAM on the VPS must allow `logs:CreateLogStream` + `logs:PutLogEvents`.

### Correlating logs with Sentry

Both pipelines stamp the same `request_id`. In Sentry, filter by `tags.request_id = <id>`. In Loki/Datadog/CloudWatch, search for the same value. End-to-end trace in under 30 seconds.

---

## 3. Metrics (future — OpenTelemetry)

Not yet wired. When we add it, the path is:

1. Install `opentelemetry-distro`, `opentelemetry-exporter-otlp`, `opentelemetry-instrumentation-fastapi`, `opentelemetry-instrumentation-sqlalchemy`, `opentelemetry-instrumentation-redis`.
2. Bootstrap in `zerozero_api/main.py`:

   ```python
   from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
   from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
   from opentelemetry.instrumentation.redis import RedisInstrumentor

   FastAPIInstrumentor.instrument_app(app)
   SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
   RedisInstrumentor().instrument()
   ```
3. Export to an OTLP collector (Grafana Tempo / Honeycomb / Datadog APM):

   ```bash
   OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com
   OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer <token>
   OTEL_SERVICE_NAME=zerozero-backend
   OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
   ```

4. Frontend: `@sentry/react` already collects Web Vitals; for richer RUM, add `@opentelemetry/sdk-trace-web` once backend traces are flowing.

---

## 4. Dashboards to build

Target Grafana (or Datadog equivalent). Each dashboard below is one panel per bullet.

### 4a. API Health

- **p50 / p95 / p99 request latency** — histogram, grouped by route
- **Error rate (%)** — `5xx count / total count`, alert if > 1% over 5 min
- **Requests per second** — line chart, grouped by route
- **DB pool saturation** — `active connections / pool size`

### 4b. Realtime (WebSocket)

- **Active WS connections** — gauge, scraped from `/metrics` (future) or logged every 10 s
- **WS messages per second** — sent vs received
- **Redis pub/sub throughput** — `commands/sec` on the `orders:*` channel pattern
- **Pub/sub lag** — time between producer publish and consumer receive (requires timestamp in payload)

### 4c. Business signals

- **Orders placed / minute** — sum over `event="order.placed"` log lines
- **Checkout funnel** — login → cart → checkout → payment success, drop-off per step
- **Partner availability** — live count of partners with `status="online"`

### 4d. Infra

- **CPU / memory per container** — from Docker stats or node-exporter
- **Disk usage on `/srv`** — alert at 80%
- **Postgres slow queries** — `pg_stat_statements` top 10

### Alerts (minimum set)

| Alert                         | Condition                              | Severity |
|-------------------------------|----------------------------------------|----------|
| Backend 5xx spike             | error rate > 1% for 5 min              | page     |
| Backend p95 latency           | p95 > 1s for 10 min                    | page     |
| DB connection exhaustion      | pool saturation > 90% for 2 min        | page     |
| Disk > 80%                    | `/srv` usage > 80%                     | warn     |
| Sentry new-issue burst        | > 10 new issues in 10 min              | warn     |
| Deploy failed                 | GitHub Actions `deploy.yml` failure    | warn     |

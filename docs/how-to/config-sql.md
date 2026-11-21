# How to inspect config with SQL

There is no single `config` table. Saved product configuration lives in ordinary Postgres tables next to runs and points. Day-to-day edits belong in the app UI. Use SQL for inspection, debugging, and local cleanup.

Time series samples are covered separately: [points-timeseries.md](./points-timeseries.md). Compose and `DATABASE_URL`: [user-guide-v1.md](./user-guide-v1.md).

## Connect

```bash
psql "postgres://p2v3:p2v3@localhost:5433/p2v3"
```

Same URL as `.env.example`. Compose service `db` must be up (`docker compose up -d`). Schema source of truth: [`src/db/schema.ts`](../../src/db/schema.ts) and migrations under [`drizzle/`](../../drizzle/).

## Which tables are config

| Kind | Tables |
|---|---|
| **Config** | `connections`, `jobs`, `reductions`, `monitors`, `monitor_jobs` |
| **Runtime / history** | `runs`, `points`, `monitor_states`, `notifications` |

`connections.config` is a **JSONB column** on `connections` (source-specific settings), not its own table. Prefer not to `SELECT secret` unless you need it; that column holds the live credential.

```sql
-- Inventory
\dt

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

## Read

### Jobs

```sql
SELECT id, name, enabled, health, query, static_tags, dynamic_tags,
       window_mode, max_lookback_seconds, interval_seconds, cron, connection_id
FROM jobs
ORDER BY name;

SELECT id, name FROM jobs WHERE name ILIKE '%UPS%';

SELECT id, name, query, static_tags, dynamic_tags
FROM jobs
WHERE id = '<job-uuid>';
```

### Reductions (metrics a job writes)

```sql
SELECT position, aggregation, metric_name, field, filter
FROM reductions
WHERE job_id = '<job-uuid>'
ORDER BY position;
```

### Connections

```sql
SELECT id, name, source_type, config, secret_ref, created_at
FROM connections
ORDER BY name;
```

### Monitors

```sql
SELECT id, name, metric_name, tag_filter, threshold, severity,
       consecutive_points, team, notify_mode, created_at
FROM monitors
ORDER BY name;

-- Which jobs a monitor watches
SELECT m.name AS monitor, j.name AS job, mj.job_id
FROM monitor_jobs mj
JOIN monitors m ON m.id = mj.monitor_id
JOIN jobs j ON j.id = mj.job_id
ORDER BY m.name, j.name;
```

### Open alert state (not config, often needed next to it)

```sql
SELECT monitor_id, series_key, tags, status, value, page_severity, alert_opened_at, updated_at
FROM monitor_states
WHERE status = 'alert'
ORDER BY updated_at DESC;
```

## Write and delete

**Preferred:** create and edit connections, jobs, and monitors in the UI. That path validates forms and keeps related rows (reductions, `monitor_jobs`) consistent via [`src/db/store.ts`](../../src/db/store.ts).

**SQL updates** are fine for local one-off fixes when you know the shape (for example correcting `static_tags` on a copied job). Prefer a tight `WHERE` and check with `SELECT` first.

```sql
-- Example: fix static tags on one job (local only)
UPDATE jobs
SET static_tags = '{"status":"FAULTED","hall_id":"HALL-01","asset_id":"UPS-01"}'::jsonb
WHERE id = '<job-uuid>';
```

**SQL deletes** cascade in some places (`reductions` and `runs` follow the job; `monitor_jobs` / `monitor_states` / `notifications` follow the monitor or job as defined in the schema). Confirm FKs before deleting. There is no undo.

```sql
-- Example: remove one job (cascades reductions and runs; points are not FK-cascaded from jobs)
DELETE FROM jobs WHERE id = '<job-uuid>';
```

Points for a deleted job may remain until you delete them separately. See [points-timeseries.md](./points-timeseries.md).

**Full wipe:** `docker compose down -v` drops the Postgres volume (all config and points). See [user-guide-v1.md](./user-guide-v1.md).

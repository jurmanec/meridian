# How to work with points (time series)

Collection jobs reduce source windows into numbered samples. Those samples are the product’s time series. There is no separate metrics store and no points admin UI beyond the job page.

## Where they live

Points are rows in the Postgres / TimescaleDB `points` hypertable (Compose service `db`, port **5433**, volume `p2v3-pg`). Schema: [`drizzle/0000_m1_schema.sql`](../../drizzle/0000_m1_schema.sql). Drizzle model: `points` in [`src/db/schema.ts`](../../src/db/schema.ts).

| Column | Meaning |
|---|---|
| `time` | Sample time (timestamptz). Hypertable partition key. Successful runs stamp every point from that run at the **window end**. |
| `job_id` | Collection job that wrote the point. |
| `metric_name` | Named reduction output (for example `row_count`). |
| `tags` | JSONB label set (static tags merged with dynamic tags from the source). |
| `value` | Double. |
| `run_id` | Optional link to the successful `runs` row. |

Primary key: `(time, job_id, metric_name, tags)`. One series is one job + one metric + one exact tag map. Open a shell with:

```bash
psql "postgres://p2v3:p2v3@localhost:5433/p2v3"
```

Same URL as `DATABASE_URL` in [`.env.example`](../../.env.example). Compose must be up (`docker compose up -d`). See [user-guide-v1.md](./user-guide-v1.md).

## Read

**Day to day:** open the job page (`/jobs/[id]`). It lists recent runs and recent points for that job.

**Ad hoc / cross-job:** use `psql`.

```sql
-- Recent points for a job
SELECT time, metric_name, tags, value, run_id
FROM points
WHERE job_id = '<job-uuid>'
ORDER BY time DESC
LIMIT 50;

-- One series (exact tags)
SELECT time, value, run_id
FROM points
WHERE job_id = '<job-uuid>'
  AND metric_name = 'row_count'
  AND tags = '{"asset_id":"UPS-01","hall_id":"HALL-01","status":"FAULTED"}'::jsonb
ORDER BY time DESC
LIMIT 20;

-- Resolve job id by name
SELECT id, name FROM jobs WHERE name ILIKE '%UPS%';
```

**In code:** `readPoint` (exact identity) and `getJobDetail` (job plus recent points) in [`src/db/store.ts`](../../src/db/store.ts). Monitors read stored points only; they do not re-query the source.

## Write

**Preferred:** run the collection job (Run now, or wait for the schedule while `npm run dev` is up). The scheduler path in [`src/scheduler/run-due.ts`](../../src/scheduler/run-due.ts) merges static tags, applies condition zero-fill when configured, creates a successful `runs` row, calls `writePoint` for each sample, then evaluates monitors.

Do not invent a parallel write path for normal collection. Tags, run linkage, and monitor evaluation stay consistent only on that path.

**Tests / deliberate seeding:** `writePoint(db, { time, jobId, metricName, tags, value, runId? })` in [`src/db/store.ts`](../../src/db/store.ts). Use this when a test needs a point that did not come from a connector run. Prefer real job runs when debugging live monitors.

## Delete

There is no product API to delete points.

**Targeted cleanup (local):** SQL. Scope tightly by `job_id`, time, and/or tags.

```sql
DELETE FROM points
WHERE job_id = '<job-uuid>'
  AND time >= '2026-11-19T00:00:00Z';

DELETE FROM points
WHERE job_id = '<job-uuid>'
  AND metric_name = 'row_count'
  AND tags @> '{"asset_id":"ROOM-01"}'::jsonb;
```

**Tests:** Drizzle `db.delete(points).where(...)` (same pattern as existing `*.test.ts` files).

**Full wipe:** `docker compose down -v` removes the Postgres volume. Jobs, monitors, runs, and points are gone. DynamoDB Local was already empty. See [user-guide-v1.md](./user-guide-v1.md).

Deleting points does not by itself clear open monitor state or notifications. If you are resetting alert behavior, check `monitor_states` (and related notify history) as well as `points`.

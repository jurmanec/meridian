# ADR-008: PostgreSQL + TimescaleDB as the single store

Status: Accepted
Date: 2026-11-13
Recorded: 2026-11-19
Scope: Local and app persistence — Compose `db` image, `DATABASE_URL`, `points` hypertable, Drizzle schema under `src/db/` and `drizzle/`

## Decision
Use **one PostgreSQL database with the TimescaleDB extension** for both:

| Plane | What | How |
|-------|------|-----|
| Control / config | Connections, jobs, reductions, monitors, monitor membership, alert state, notification history | Ordinary Postgres tables, FKs, JSONB |
| Data / series | Reduced collection samples | `points` as a Timescale **hypertable** on `time` |

There is no separate metrics database in this stack. The app uses one `DATABASE_URL`, Drizzle, and SQL. Timescale is PostgreSQL with time-series features, not a different product beside Postgres.

## Context
Collection jobs reduce source windows into tagged scalars and write immutable points. Monitors read only those points. Config needs relational integrity (jobs ↔ reductions ↔ monitors). Points need append-heavy, time-keyed storage that can grow. Early Meridian is a single Next.js process plus Compose; operating two stores (e.g. Postgres + Prometheus/VictoriaMetrics) was unnecessary cost for the starter path. The tech-stack note already preferred “Postgres for config + Timescale for points in one DB,” with a later option to split metrics out.

## Rejected Alternatives
- **Plain PostgreSQL only (no Timescale):** Rejected for the long-lived `points` table — no first-class time partitioning / compression path. Config tables alone would have been fine on vanilla Postgres; the series workload is why Timescale is in the image.
- **Dedicated metrics engine from day one (VictoriaMetrics, Prometheus, Influx, ClickHouse):** Rejected for v1 — second system, different query model, weaker join path to job/monitor config. Remains the growth option if points volume or query patterns outgrow one DB.
- **MongoDB (or document DB) for everything:** Rejected — config wants constraints and joins; after collection-time reduction the durable workload is relational config + time series, not long-term raw documents. See the comparison in the tech-stack note.
- **Separate control-plane Postgres and data-plane store immediately:** Deferred — clean evolution later; not required while volume and ops stay small.

## Consequences
- Local Compose runs `timescale/timescaledb` (Postgres 16 + extension). Migrations create `points` then `create_hypertable('points', 'time')`.
- Operators and agents use ordinary SQL (`psql`) for both config and points; see how-to docs.
- Timescale features beyond the hypertable (compression, retention policies, continuous aggregates) are available later without changing the logical schema.
- If metrics are split out later: **config and alert state stay in Postgres**; only the points store moves. Application write/read paths for series would need a new adapter.
- Revisit when retention, cardinality, or query load makes a dedicated metrics engine cheaper than scaling Timescale.

## See also
- [docs/design/data-model.md](../design/data-model.md) — tables and `points` shape
- [docs/how-to/points-timeseries.md](../how-to/points-timeseries.md), [docs/how-to/config-sql.md](../how-to/config-sql.md)
- `docker-compose.yml`, `drizzle/0000_m1_schema.sql`

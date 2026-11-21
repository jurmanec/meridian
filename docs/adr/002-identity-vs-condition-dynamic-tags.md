# ADR-002: Distinguish identity vs condition dynamic tags

Status: Accepted
Date: 2026-11-14
Scope: `src/db/dynamic-tags.ts` (`absent`), `src/scheduler/run-due.ts`, job form series-role UI

## Decision
Each dynamic tag has a series role via `absent`: **`omit` (identity, default)** or **`zero` (condition)**. Identity tags behave as before: if a combination does not appear in a successful run, no point is written for that series. Condition tags are for ephemeral “something is wrong” labels (e.g. `alarm_severity`). After a **successful** run, any series from the previous successful run or an open alert that includes a condition tag and was not written this run gets a **synthetic point with value `0`**, so monitors can resolve. Failed runs still write nothing.

## Context
Monitors evaluate the latest N points per exact tag set. When a path tag such as `alarm_severity` only exists while faults are present, a cleared facility leaves **no new point** for that series. The last point stays above threshold and the alert never resolves. Treating every missing series as zero would invent identity series (e.g. assets that simply did not appear) and is wrong for paging.

## Rejected Alternatives
- **Always invent zero for any missing prior series:** Rejected — invents identity series and false “all clear” for assets that were not in the window.
- **Resolve alerts when the job writes any points, ignoring series key:** Rejected — breaks per-series state and multi-asset / multi-severity monitors.
- **Require operators to delete monitors or manually clear state:** Rejected — operational hazard; product should close cleanly.
- **Separate “clearing” metrics:** Rejected — doubles job surface; condition zeros reuse the same metric and tags.

## Consequences
- Operators mark ephemeral tags as condition; stable dimensions (`asset_id`, `hall_id`, …) stay identity.
- Successful empty-of-condition runs emit zeros for open/prior condition series; cardinality of zeros is bounded by prior/open sets, not the full tag space.
- Failed reads still neither clear nor extend streaks.
- Revisit if condition zeros become noisy or if we need TTL / max age for synthetic clears.

## See also
- [ADR-001](001-generic-path-dynamic-tags.md) — path dynamic tags
- [ADR-007](007-identity-alert-key-severity-updates.md) — identity-keyed `alert_key`

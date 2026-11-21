# ADR-003: Structured monitor page severity (unset / fixed / from_tag)

Status: Accepted
Date: 2026-11-14
Scope: `src/db/severity.ts`, `monitors.severity` (jsonb), monitor form, `src/monitor/evaluate.ts`, `src/monitor/message.ts`

## Decision
**Page severity** (policy for the alert / future C3) is stored as structured config, not free text:

- `unset` — no page severity
- `fixed` — enum `critical` | `warning` | `info`
- `from_tag` — read a series tag name, map tag values → enum, `whenMissing`: `omit` or `fixed` fallback

**Observed** severity (how bad the plant row looked) stays a **series tag** from collection (often a path dynamic tag). The monitor may map that tag into the page enum at fire time. Slack does **not** print a separate `*Severity:*` line; the firing headline uses severity icons when the enum resolves (`🚨 *CRITICAL*`, `⚠️ *WARNING*`, `ℹ️ *INFO*`), otherwise `:rotating_light:`.

## Context
Paging sinks need a small closed severity set. Plant strings may not match that enum. Splitting observation (tag) from policy (monitor config) keeps series filterable while page severity stays explicit. Duplicating the mapped value as `*Severity:*` when it already appears on `*Series:*` clutters the channel.

## Rejected Alternatives
- **Free-text severity on the monitor:** Rejected — unsafe for page/no-page decisions.
- **Page severity only on the monitor, no series split:** Rejected — cannot alert differently for critical vs warning plant rows from one job.
- **Infer page severity only from tag equality with no map:** Rejected — plant spellings (`CRIT`, `Warning`) need an explicit map.
- **Always show `*Severity:*` in Slack:** Rejected when the value already comes from tags; icon carries fixed/from_tag resolution on fire.

## Consequences
- Legacy string severities migrate to `{ mode: "fixed", fixed }` or `unset`.
- From-tag monitors need a correct tag name and map; missing/unmapped values omit or use fallback.
- Slack icons depend on `resolveSeverity` at transition time (fixed or from_tag).
- Align enum values with accepted C3 (ADR-005); revisit if consumers need more levels or require severity on every message body.

## See also
- [ADR-005](005-c3-alert-contract-v0.2.md), [ADR-007](007-identity-alert-key-severity-updates.md)


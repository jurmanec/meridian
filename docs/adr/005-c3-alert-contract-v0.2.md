# ADR-005: Emit C3-shaped alert webhook

Status: Accepted
Date: 2026-11-14
Accepted: 2026-11-15
Updated: 2026-11-16 (scope: body/transport only; sinks → ADR-006)
Scope: `src/monitor/c3.ts` and evaluate’s alert-webhook delivery

## Decision
C3 **0.2** closed 2026-11-15; C3 **0.3** accepted the same day. When a monitor delivers via **alert webhook** (ADR-006), Meridian POSTs the **currently accepted** C3 producer shape (`POST` to that URL’s `/v1/alerts`, `202`/`200` success, retry on server errors / timeouts; no retry on `400`/`401`).

As of 2026-11-15 the emitter sends **0.3**: series tags as `labels`; monitor/job/metric facts in opaque `details`; optional `identity_tags`. `alert_key` is opaque and stable fire→resolve; no top-level `asset_id`; `severity` may be absent. Hashing, retry timing, and how a consumer handles missing severity / out-of-order resolve stay in consumer design, not in the C3 field set.

Which sink a monitor uses (Slack vs alert webhook) is **ADR-006**, not this decision.

## Context
Downstream alert consumers need a stable, domain-blind envelope for threads, severity routing, team/manual, and related memory. C3 0.1 used `monitor:job:asset` and required plant-shaped fields. Meridian already has multi-tag series and structured severity. C3 **0.3** generalizes the envelope so other producers (e.g. Alertmanager-shaped) can use the same intake.

## Rejected Alternatives
- **Ship C3 0.1 as written:** Rejected — collapses series; top-level `asset_id` breaks domain-blind design.
- **Delay any contract until emit code exists:** Rejected — consumers cannot build intake against a moving target.
- **Make severity mandatory on the wire in 0.2/0.3:** Deferred — missing-severity policy is interim / consumer design.
- **Put Slack `channel`/`ts` on C3:** Rejected — out of scope for the producer contract; a Slack-proxy consumer creates the parent itself.

## Consequences
- Meridian emits C3 **0.3** on the alert-webhook path; consumers may accept 0.2 and 0.3.
- Request signing, the exact retry schedule, and undelivered board remain later / out of C3.
- Bumping the emitted C3 version later is an update to this ADR (or a superseding ADR), not a silent field dump.

## See also
- [ADR-006](006-exclusive-notify-sinks.md) — exclusive Slack vs alert webhook
- [ADR-007](007-identity-alert-key-severity-updates.md) — identity-keyed `alert_key`

# ADR-007: Identity-keyed alert_key and severity updates

Status: Accepted
Date: 2026-11-18
Scope: `src/monitor/c3.ts` (`buildAlertKey`), `src/monitor/evaluate.ts`, `monitor_states.page_severity`

## Decision
Hash **identity** tags (full series tags minus job condition keys) into C3 `alert_key`. Keep timeseries and per-series monitor state at full tag grain. When page severity changes while an identity incident is still ALERT, emit another `FIRING` (new `event_id`, same `alert_key`, new `severity`, original `fired_at`) instead of resolve+reopen. Jobs with no condition tags keep one-series-one-incident behavior.

## Context
Condition tags such as `alarm_severity` made warning and critical different series and different `alert_key`s. Operators need one incident (one Slack parent / one webhook thread id) that updates when severity escalates or clears. Industry parallel: Alertmanager fingerprint without severity in labels; PagerDuty priority update on one incident.

## Rejected Alternatives
- **Soft-merge threads via `identity_tags` while hashing full labels:** Rejected — `alert_key` must remain the thread id.
- **New C3 transition (`UPDATED`):** Deferred — open+FIRING with changed severity is enough if the webhook consumer treats that as an update on the open incident.
- **Collapse timeseries to identity only:** Rejected — loses condition history and ADR-002 zeros.

## Consequences
- Producer hash recipe changes; C3 0.3 field shape unchanged. Consumers should treat severity-changing `FIRING` on an open `alert_key` as an update, not a second open incident.
- Direct Slack webhook cannot edit parent on severity change until bot in-place lifecycle (ADR-004) or a consumer that owns Slack posting.
- Revisit if multiple condition series for one identity need a different severity rollup than highest-of-open.

## See also
- [ADR-002](002-identity-vs-condition-dynamic-tags.md), [ADR-005](005-c3-alert-contract-v0.2.md), [ADR-006](006-exclusive-notify-sinks.md)

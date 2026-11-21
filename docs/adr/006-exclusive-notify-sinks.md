# ADR-006: Exclusive notify sinks (Slack vs alert webhook)

Status: Accepted
Date: 2026-11-15
Accepted: 2026-11-15
Scope: `monitors.notify_mode` / `slack_webhook` / `alert_webhook`; Notifications UI; `src/monitor/evaluate.ts` paging path

## Decision
Each monitor chooses exactly one notify destination on a paged transition:

| Mode | UI label | Behavior |
|------|----------|----------|
| `slack` | Slack | Post to the monitor’s Slack incoming webhook only |
| `webhook` | Alert webhook | POST C3 (accepted version; see ADR-005) to the monitor’s alert webhook URL only — no Slack |

There is no dual-emit. Optional env `P8_ALERT_URL` may **prefill** the alert-webhook field on new monitors; it does not enable a second sink by itself.

## Context
Meridian started as Slack-only, then briefly posted C3 alongside Slack when `P8_ALERT_URL` was set. That dual path confused ownership (who posts the channel message) and blocked treating Meridian like other industry alert sources that hand off to an on-call or webhook consumer. Operators still need a simple Slack path without that handoff.

## Rejected Alternatives
- **Dual-emit (Slack + C3 on every page):** Rejected — two owners of the incident surface; hard to reason about.
- **Deployment-only sink (env switch, no per-monitor UI):** Rejected — Slack URLs are already per-monitor; mixed fleets need both modes.
- **Post Slack and forward `channel`/`ts` on the C3 body:** Rejected as the primary multi-source path — couples C3 to Slack and does not extend to Grafana/etc.
- **Reuse the Slack webhook field for C3 URLs:** Rejected — different contracts and credentials; keep separate fields.

## Consequences
- Alert-webhook monitors are how Meridian feeds any C3 consumer without posting Slack.
- ADR-004 (resolve-in-place) applies only to **Slack** mode when implemented.
- Undelivered-alert board and request signing remain later.
- This ADR only binds Meridian’s exclusive sinks; how a particular consumer posts Slack after intake is outside scope here.

## See also
- [ADR-005](005-c3-alert-contract-v0.2.md) — C3 body and transport when alert webhook is chosen
- [ADR-004](004-slack-resolve-in-place.md) — Slack-mode lifecycle (Proposed)

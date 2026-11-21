# Architecture decision records

Short, numbered decisions for Meridian. One decision per file.

**Status:** `Proposed` | `Accepted` | `Superseded by ADR-0xx` | `Deprecated`

## Template

```markdown
# ADR-NNN: Short decision title

Status: Accepted
Date: YYYY-MM-DD
Scope: paths or concepts this binds

## Decision
What we chose, in a few sentences.

## Context
Why the decision was needed.

## Rejected Alternatives
- Option: why not.

## Consequences
Tradeoffs and when to revisit.

## See also
Optional links to planning notes or code.
```

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-generic-path-dynamic-tags.md) | Generic path dynamic tags | Accepted |
| [002](002-identity-vs-condition-dynamic-tags.md) | Identity vs condition dynamic tags | Accepted |
| [003](003-monitor-page-severity.md) | Structured monitor page severity | Accepted |
| [004](004-slack-resolve-in-place.md) | Slack alert lifecycle via Web API | Proposed |
| [005](005-c3-alert-contract-v0.2.md) | Emit C3-shaped alert webhook (0.3) | Accepted |
| [006](006-exclusive-notify-sinks.md) | Exclusive notify sinks (Slack vs alert webhook) | Accepted |
| [007](007-identity-alert-key-severity-updates.md) | Identity-keyed alert_key and severity updates | Accepted |
| [008](008-postgresql-timescaledb.md) | PostgreSQL + TimescaleDB as the single store | Accepted |

# ADR-001: Use generic path + pick for derived dynamic tags

Status: Accepted
Date: 2026-11-14
Scope: `src/db/dynamic-tags.ts`, job form dynamic tags, DynamoDB snapshot → reduce path

## Decision
Derived series tags are configured as a **path** (e.g. `alarms[*].severity`), a **tag name** written on the series, and a **pick** rule that collapses many string values to one: `first`, `last`, or `priority` (ordered list, case-insensitive match, stored spelling from the list). When the pick finds nothing, use a configured literal or omit the tag. The collector does not assume plant field names or a built-in severity ranking.

## Context
We need series labels derived from nested source data (alarms severity is the first example). A severity-only “max alarm” feature would bake facility vocabulary into the core. Paths can yield arbitrary strings with no inherent order, so “highest” must be user-defined.

## Rejected Alternatives
- **Hard-coded max alarm severity / magic `$alarm_severity`:** Rejected — not generic; assumes `alarms` and a fixed rank.
- **Store the full list as the tag value:** Rejected — explodes series cardinality; monitors cannot filter cleanly.
- **Expression language for pick:** Rejected — too much surface for current needs; closed pick set is enough.

## Consequences
- One mechanism covers severity-style and other nested scalars.
- Users must configure priority lists when order matters; empty/unknown values need an explicit when-empty policy.
- Snapshot items keep enough structure for path evaluation at collect time; nested payloads are not stored on points.
- Revisit if we need numeric max/min or multi-value tags as first-class series identity.

## See also
- [ADR-002](002-identity-vs-condition-dynamic-tags.md) — identity vs condition tags

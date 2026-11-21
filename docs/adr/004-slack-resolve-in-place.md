# ADR-004: Resolve Slack alerts in place via Web API

Status: Proposed
Date: 2026-11-14
Scope: planned `src/monitor/slack.ts`, evaluate notify path, monitor Slack config; see planning note

## Decision
When a series recovers, **edit the original firing Slack message** to a RESOLVED parent (same channel timeline item) and **post a short reply in that message’s thread**. Do not rely on a second top-level RESOLVED webhook post as the primary UX. Delivery uses a **bot token** (`xoxb-…`) with **`chat:write`**, a **channel id**, and a stored parent message **`ts`** per open series. Incoming webhooks remain a fallback for fire-only or when no `ts` exists. A Slack **verification token** is not used for posting or editing.

## Context
Paired top-level FIRING / RESOLVED messages make alert channels hard to scan. Operators want one parent that flips to resolved, with recovery detail in-thread. Current delivery is webhook-only and cannot edit or thread reliably.

## Rejected Alternatives
- **Keep webhook-only double posts:** Rejected as primary UX — noisy channel, harder to track open incidents.
- **`connections:write` or verification token as the credential:** Rejected — wrong Slack surfaces; cannot call `chat.update` / threaded `chat.postMessage`.
- **Delete the firing message and post a new resolved one:** Rejected — loses thread context and channel position.
- **Events API / interactive ack as part of this change:** Deferred — not required for edit + thread reply.

## Consequences
- Requires bot install, channel invite, token + channel config, and persistence of `{ channel, ts, firedAt }` while ALERT.
- Slightly more operational setup than a webhook URL; clearer incident threads once live.
- Fallback top-level RESOLVED if parent `ts` is missing so recovery is never silent.
- Applies only when the monitor’s notify mode is **Slack** ([ADR-006](006-exclusive-notify-sinks.md)); alert-webhook monitors do not post Slack from Meridian.
- Status stays **Proposed** until implemented; detailed shapes and edge cases stay in local planning notes (not in the public tree).

## See also
- [ADR-006](006-exclusive-notify-sinks.md)


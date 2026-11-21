import { createHash, randomUUID } from "node:crypto";
import type { SeverityLevel } from "@/db/severity";
import { isSeverityLevel } from "@/db/severity";
import type { Tags } from "@/db/schema";
import { normalizeTags } from "@/db/tags";
import type { SlackTransition } from "./message";

export type C3Transition = "FIRING" | "RESOLVED";

export type C3AlertDetails = {
  monitor_id: string;
  monitor_name: string;
  job_id: string;
  condition_tag_keys?: string[];
  metric_name: string;
  value: number;
  threshold: number;
  consecutive_points: number;
  window_start: string;
  window_end: string;
};

export type C3AlertEvent = {
  contract: "p8.alert";
  version: "0.3";
  event_id: string;
  alert_key: string;
  transition: C3Transition;
  emitted_at: string;
  fired_at: string;
  resolved_at: string | null;
  source: "p2";
  severity?: SeverityLevel;
  team?: string;
  manual_url?: string;
  summary: string;
  labels: Tags;
  identity_tags?: Tags;
  details: C3AlertDetails;
};

export type AlertEventSender = (event: C3AlertEvent, baseUrl: string) => Promise<void>;

/** Compact lexicographic JSON of tags → SHA-256 → first 16 hex (P2-internal D1 recipe). */
export function tagDigest(tags: Tags): string {
  const normalized = normalizeTags(tags);
  const json = JSON.stringify(normalized);
  return createHash("sha256").update(json, "utf8").digest("hex").slice(0, 16);
}

export function identityTagsFrom(tags: Tags, conditionKeys: string[]): Tags {
  const skip = new Set(conditionKeys);
  return normalizeTags(
    Object.fromEntries(Object.entries(normalizeTags(tags)).filter(([key]) => !skip.has(key))),
  );
}

/**
 * Thread id for C3. Digests **identity** tags (full tags minus condition keys).
 * When there are no condition keys, identity equals the full tag map.
 * See docs/planning/002-identity-alert-severity-updates.md.
 */
export function buildAlertKey(
  monitorId: string,
  jobId: string,
  tags: Tags,
  conditionTagKeys: string[] = [],
): string {
  return `${monitorId}:${jobId}:${tagDigest(identityTagsFrom(tags, conditionTagKeys))}`;
}

export function c3Transition(transition: SlackTransition): C3Transition {
  return transition === "firing" ? "FIRING" : "RESOLVED";
}

export function buildC3AlertEvent(input: {
  monitorId: string;
  monitorName: string;
  jobId: string;
  transition: SlackTransition;
  tags: Tags;
  conditionTagKeys: string[];
  value: number;
  metricName: string;
  threshold: number;
  consecutivePoints: number;
  windowStart: Date;
  windowEnd: Date;
  team: string;
  manualUrl: string;
  severity: string | null | undefined;
  firedAt: Date;
  emittedAt?: Date;
  eventId?: string;
}): C3AlertEvent {
  const emittedAt = input.emittedAt ?? new Date();
  const labels = normalizeTags(input.tags);
  const conditionKeys = [...new Set(input.conditionTagKeys)].sort();
  const transition = c3Transition(input.transition);
  const pointsLabel = input.consecutivePoints === 1 ? "point" : "points";
  const summary =
    transition === "FIRING"
      ? `${input.metricName} ${input.value} ≥ threshold ${input.threshold} for ${input.consecutivePoints} consecutive ${pointsLabel}`
      : `${input.metricName} ${input.value} no longer ≥ threshold ${input.threshold} for ${input.consecutivePoints} consecutive ${pointsLabel}`;

  const details: C3AlertDetails = {
    monitor_id: input.monitorId,
    monitor_name: input.monitorName,
    job_id: input.jobId,
    metric_name: input.metricName,
    value: input.value,
    threshold: input.threshold,
    consecutive_points: input.consecutivePoints,
    window_start: input.windowStart.toISOString(),
    window_end: input.windowEnd.toISOString(),
  };
  if (conditionKeys.length > 0) {
    details.condition_tag_keys = conditionKeys;
  }

  const identityTags = identityTagsFrom(labels, conditionKeys);
  const event: C3AlertEvent = {
    contract: "p8.alert",
    version: "0.3",
    event_id: input.eventId ?? randomUUID(),
    alert_key: buildAlertKey(input.monitorId, input.jobId, labels, conditionKeys),
    transition,
    emitted_at: emittedAt.toISOString(),
    fired_at: input.firedAt.toISOString(),
    resolved_at: transition === "RESOLVED" ? emittedAt.toISOString() : null,
    source: "p2",
    summary,
    labels,
    details,
  };

  if (isSeverityLevel(input.severity)) {
    event.severity = input.severity;
  }
  const team = input.team.trim();
  if (team) {
    event.team = team;
  }
  const manualUrl = input.manualUrl.trim();
  if (manualUrl) {
    event.manual_url = manualUrl;
  }
  if (conditionKeys.length > 0) {
    event.identity_tags = identityTags;
  }

  return event;
}

export function resolveP8AlertUrl(raw: string | undefined | null = process.env.P8_ALERT_URL): string | null {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }
  return trimmed.endsWith("/v1/alerts") ? trimmed : `${trimmed}/v1/alerts`;
}

const RETRY_DELAYS_MS = [200, 800, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** POST one C3 event. Retries on 5xx / 429 / network; does not retry 400/401. */
export async function postC3Alert(event: C3AlertEvent, baseUrl: string): Promise<void> {
  const url = resolveP8AlertUrl(baseUrl);
  if (!url) {
    throw new Error("P8 alert URL is empty");
  }
  const body = JSON.stringify(event);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-p8-event-id": event.event_id,
        },
        body,
      });
      if (response.status === 202 || response.status === 200) {
        return;
      }
      if (response.status === 400 || response.status === 401) {
        throw new Error(`P8 rejected alert (${response.status})`);
      }
      lastError = new Error(`P8 returned ${response.status}`);
      if (response.status < 500 && response.status !== 429) {
        throw lastError;
      }
    } catch (error) {
      if (error instanceof Error && /P8 rejected alert/.test(error.message)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error("P8 request failed");
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }
  throw lastError ?? new Error("P8 request failed");
}

export async function deliverC3Alert(
  event: C3AlertEvent,
  options: { baseUrl?: string | null; send?: AlertEventSender } = {},
): Promise<void> {
  const raw = options.baseUrl === undefined ? process.env.P8_ALERT_URL : options.baseUrl;
  const url = resolveP8AlertUrl(raw);
  if (!url) {
    return;
  }
  const send = options.send ?? postC3Alert;
  await send(event, url);
}

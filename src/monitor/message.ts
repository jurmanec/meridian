import type { SeverityLevel } from "@/db/severity";
import { isSeverityLevel } from "@/db/severity";
import type { TagFilter, Tags } from "@/db/schema";
import { normalizeTags } from "@/db/tags";

export type SlackTransition = "firing" | "resolved";

const severityIcons: Record<SeverityLevel, string> = {
  critical: "🚨",
  warning: "⚠️",
  info: "ℹ️",
};

export function seriesKey(tags: Tags, jobId?: string): string {
  const normalized = normalizeTags(tags);
  return JSON.stringify(jobId ? { jobId, tags: normalized } : normalized);
}

/** Identity-grain incident row in `monitor_states` (condition tags excluded from the key). */
export function incidentSeriesKey(jobId: string, identityTags: Tags): string {
  return JSON.stringify({ jobId, incident: normalizeTags(identityTags) });
}

export function isIncidentSeriesKey(key: string): boolean {
  try {
    const parsed = JSON.parse(key) as { incident?: unknown };
    return parsed != null && typeof parsed === "object" && "incident" in parsed;
  } catch {
    return false;
  }
}

export function readSeriesJobId(key: string): string | undefined {
  try {
    const parsed = JSON.parse(key) as { jobId?: unknown };
    return typeof parsed.jobId === "string" ? parsed.jobId : undefined;
  } catch {
    return undefined;
  }
}

export function matchesFilter(tags: Tags, filter: TagFilter): boolean {
  return Object.entries(filter).every(([key, allowed]) => {
    const value = tags[key];
    return typeof value === "string" && allowed.includes(value);
  });
}

export function canPage(tags: Tags): boolean {
  return typeof tags.asset_id === "string" && tags.asset_id.length > 0;
}

export function slackText(input: {
  monitorName: string;
  transition: SlackTransition;
  value: number;
  tags: Tags;
  metricName: string;
  threshold: number;
  consecutivePoints: number;
  windowStart: Date;
  windowEnd: Date;
  manualUrl: string;
  /** Resolved page severity; drives the firing icon when set. */
  severity?: string | null;
}): string {
  const level = isSeverityLevel(input.severity) ? input.severity : null;
  const icon =
    input.transition === "resolved"
      ? ":white_check_mark:"
      : level
        ? `${severityIcons[level]} *${level.toUpperCase()}*`
        : ":rotating_light:";
  const headline =
    input.transition === "firing"
      ? `Monitor FIRING: *${input.monitorName}*`
      : `Monitor RESOLVED: *${input.monitorName}*`;
  const state = input.transition === "firing" ? "OK → ALERT" : "ALERT → OK";
  const pointsLabel = input.consecutivePoints === 1 ? "point" : "points";
  const detail =
    input.transition === "firing"
      ? `value ${input.value} matched GTE threshold ${input.threshold} for ${input.consecutivePoints} consecutive ${pointsLabel} for metric ${input.metricName}`
      : `value ${input.value} no longer matched GTE threshold ${input.threshold} for ${input.consecutivePoints} consecutive ${pointsLabel} for metric ${input.metricName}`;
  const tags = Object.entries(normalizeTags(input.tags))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");

  const lines = [`${icon} ${headline}`, `*State:* ${state}`];
  if (tags) {
    lines.push(`*Series:* ${tags}`);
  }
  lines.push(
    `*Detail:* ${detail}`,
    `*Window:* ${input.windowStart.toISOString()} – ${input.windowEnd.toISOString()}`,
  );
  if (input.manualUrl.trim()) {
    lines.push(`*URL:* ${input.manualUrl}`);
  }
  return lines.join("\n");
}

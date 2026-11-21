import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  jobs,
  monitorJobs,
  monitors,
  monitorStates,
  notifications,
  points,
  runs,
  type SeriesStatus,
  type Tags,
} from "@/db/schema";
import { conditionTagKeys, normalizeDynamicTags } from "@/db/dynamic-tags";
import {
  isSeverityLevel,
  normalizeSeverityConfig,
  resolveSeverity,
  type SeverityLevel,
} from "@/db/severity";
import { normalizeTags } from "@/db/tags";
import { identityTagsFrom, buildC3AlertEvent, deliverC3Alert, type AlertEventSender } from "./c3";
import {
  canPage,
  incidentSeriesKey,
  isIncidentSeriesKey,
  matchesFilter,
  seriesKey,
  slackText,
  type SlackTransition,
} from "./message";
import { postSlack, type SlackSender } from "./slack";

export type MonitorTransition = {
  monitorName: string;
  transition: SlackTransition;
  value: number;
  paged: boolean;
  /** FIRING that refreshes severity on an already-open identity incident. */
  severityUpdate?: boolean;
};

export type EvaluatedPoint = {
  metricName: string;
  value: number;
  tags: Tags;
  time: Date;
};

export type EvaluateOptions = {
  send?: SlackSender;
  /** When set, used instead of `postC3Alert`. Pass with `p8AlertUrl` in tests. */
  deliverAlert?: AlertEventSender;
  /** Override `P8_ALERT_URL`. `null` disables emit. */
  p8AlertUrl?: string | null;
};

type DirtyIdentity = {
  monitor: typeof monitors.$inferSelect;
  jobId: string;
  conditionKeys: string[];
  identity: Tags;
  /** Member row was ALERT before this run and is now OK. */
  memberWasAlert?: boolean;
  /** Latest page for this identity is still FIRING, while every member series is OK. */
  forceResolve?: boolean;
};

export async function evaluateMonitors(
  db: Database,
  jobId: string,
  points: EvaluatedPoint[],
  sendOrOptions: SlackSender | EvaluateOptions = postSlack,
): Promise<MonitorTransition[]> {
  const options: EvaluateOptions =
    typeof sendOrOptions === "function" ? { send: sendOrOptions } : sendOrOptions;
  const send = options.send ?? postSlack;

  const [job] = await db
    .select({ id: jobs.id, dynamicTags: jobs.dynamicTags })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  if (!job) {
    return [];
  }
  const conditionKeys = conditionTagKeys(normalizeDynamicTags(job.dynamicTags));
  const watchers = await db
    .select()
    .from(monitors)
    .innerJoin(monitorJobs, eq(monitorJobs.monitorId, monitors.id))
    .where(eq(monitorJobs.jobId, jobId));
  const ordered = [...points].sort((left, right) => left.time.getTime() - right.time.getTime());
  const transitions: MonitorTransition[] = [];
  const dirty = new Map<string, DirtyIdentity>();

  for (const point of ordered) {
    for (const row of watchers) {
      const monitor = row.monitors;
      if (monitor.metricName !== point.metricName || !matchesFilter(point.tags, monitor.tagFilter)) {
        continue;
      }
      if (conditionKeys.length === 0) {
        const transition = await evaluateSeriesDirect(db, send, jobId, monitor, point, conditionKeys, options);
        if (transition) {
          transitions.push(transition);
        }
        continue;
      }
      const update = await updateSeriesState(db, jobId, monitor, point);
      const identity = identityTagsFrom(point.tags, conditionKeys);
      let forceResolve = false;
      if (!update.changed) {
        if (update.next !== "ok") {
          continue;
        }
        forceResolve = await hasUnmatchedFiring(db, monitor.id, identity, conditionKeys);
        if (!forceResolve) {
          continue;
        }
      }
      const dirtyKey = `${monitor.id}:${incidentSeriesKey(jobId, identity)}`;
      const prior = dirty.get(dirtyKey);
      dirty.set(dirtyKey, {
        monitor,
        jobId,
        conditionKeys,
        identity,
        memberWasAlert: Boolean(prior?.memberWasAlert) || update.previous === "alert",
        forceResolve: Boolean(prior?.forceResolve) || forceResolve,
      });
    }
  }

  for (const item of dirty.values()) {
    const transition = await reconcileIdentityIncident(db, send, item, options);
    if (transition) {
      transitions.push(transition);
    }
  }
  return transitions;
}

/** No condition tags: one series = one incident (legacy path). */
async function evaluateSeriesDirect(
  db: Database,
  send: SlackSender,
  jobId: string,
  monitor: typeof monitors.$inferSelect,
  point: EvaluatedPoint,
  conditionKeys: string[],
  options: EvaluateOptions,
): Promise<MonitorTransition | undefined> {
  const tags = normalizeTags(point.tags);
  const key = seriesKey(tags, jobId);
  const { next, previous, recent, current } = await readSeriesTransition(db, jobId, monitor, tags, key);
  if (previous === next) {
    return undefined;
  }

  const transition: SlackTransition = next === "alert" ? "firing" : "resolved";
  const window = windowBounds(recent, point.time);
  const paged = canPage(tags);
  const severity = resolveSeverity(normalizeSeverityConfig(monitor.severity), tags);
  const emittedAt = new Date();
  const firedAt = transition === "firing" ? emittedAt : (current?.alertOpenedAt ?? emittedAt);

  if (paged) {
    await notifyTransition(db, send, {
      monitor,
      jobId,
      transition,
      tags,
      conditionKeys,
      value: point.value,
      window,
      severity,
      firedAt,
      emittedAt,
      options,
    });
  }

  await upsertMonitorState(db, {
    monitorId: monitor.id,
    seriesKey: key,
    tags,
    status: next,
    value: point.value,
    alertOpenedAt: next === "alert" ? firedAt : null,
    pageSeverity: next === "alert" ? severity : null,
  });
  return { monitorName: monitor.name, transition, value: point.value, paged };
}

async function updateSeriesState(
  db: Database,
  jobId: string,
  monitor: typeof monitors.$inferSelect,
  point: EvaluatedPoint,
): Promise<{ changed: boolean; previous: SeriesStatus; next: SeriesStatus }> {
  const tags = normalizeTags(point.tags);
  const key = seriesKey(tags, jobId);
  const { next, previous, current } = await readSeriesTransition(db, jobId, monitor, tags, key);
  if (previous === next) {
    return { changed: false, previous, next };
  }
  const emittedAt = new Date();
  const firedAt =
    next === "alert"
      ? (current?.status === "alert" && current.alertOpenedAt ? current.alertOpenedAt : emittedAt)
      : null;
  await upsertMonitorState(db, {
    monitorId: monitor.id,
    seriesKey: key,
    tags,
    status: next,
    value: point.value,
    alertOpenedAt: firedAt,
    pageSeverity: next === "alert" ? resolveSeverity(normalizeSeverityConfig(monitor.severity), tags) : null,
  });
  return { changed: true, previous, next };
}

async function reconcileIdentityIncident(
  db: Database,
  send: SlackSender,
  item: DirtyIdentity,
  options: EvaluateOptions,
): Promise<MonitorTransition | undefined> {
  const { monitor, jobId, conditionKeys, identity } = item;
  const severityConfig = normalizeSeverityConfig(monitor.severity);
  const incidentKey = incidentSeriesKey(jobId, identity);
  const seriesRows = await db
    .select()
    .from(monitorStates)
    .where(eq(monitorStates.monitorId, monitor.id));

  const members = seriesRows.filter((row) => {
    if (isIncidentSeriesKey(row.seriesKey)) {
      return false;
    }
    if (readJobIdFromSeriesKey(row.seriesKey) !== jobId) {
      return false;
    }
    return tagMapsEqual(identityTagsFrom(row.tags, conditionKeys), identity);
  });

  const alertMembers = members.filter((row) => row.status === "alert");
  const nextStatus: SeriesStatus = alertMembers.length > 0 ? "alert" : "ok";
  const driving =
    alertMembers.length > 0
      ? pickDrivingMember(alertMembers, severityConfig)
      : members.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const drivingTags = driving ? normalizeTags(driving.tags) : identity;
  const nextSeverity =
    nextStatus === "alert" ? resolveSeverity(severityConfig, drivingTags) : null;

  const [incident] = seriesRows.filter((row) => row.seriesKey === incidentKey);
  let previousStatus: SeriesStatus = incident?.status ?? "ok";
  if (!incident && nextStatus === "ok" && (item.memberWasAlert || item.forceResolve)) {
    previousStatus = "alert";
  }
  const previousSeverity = parseStoredSeverity(incident?.pageSeverity);

  let edge: "open" | "update" | "resolve" | null = null;
  if (previousStatus === "ok" && nextStatus === "alert") {
    edge = "open";
  } else if (previousStatus === "alert" && nextStatus === "alert" && previousSeverity !== nextSeverity) {
    edge = "update";
  } else if (previousStatus === "alert" && nextStatus === "ok") {
    edge = "resolve";
  }

  const emittedAt = new Date();
  const firedAt =
    edge === "open"
      ? emittedAt
      : (incident?.alertOpenedAt ?? driving?.alertOpenedAt ?? emittedAt);
  const transition: SlackTransition = edge === "resolve" ? "resolved" : "firing";
  const value = driving?.value ?? 0;
  const window = {
    start: driving?.updatedAt ?? emittedAt,
    end: driving?.updatedAt ?? emittedAt,
  };
  const paged = canPage(drivingTags);

  if (edge && paged) {
    await notifyTransition(db, send, {
      monitor,
      jobId,
      transition,
      tags: drivingTags,
      conditionKeys,
      value,
      window,
      severity: edge === "resolve" ? previousSeverity : nextSeverity,
      firedAt,
      emittedAt,
      options,
    });
  }

  if (edge || incident || nextStatus === "alert") {
    await upsertMonitorState(db, {
      monitorId: monitor.id,
      seriesKey: incidentKey,
      tags: drivingTags,
      status: nextStatus,
      value,
      alertOpenedAt: nextStatus === "alert" ? firedAt : null,
      pageSeverity: nextStatus === "alert" ? nextSeverity : null,
    });
  }

  if (!edge) {
    return undefined;
  }
  return {
    monitorName: monitor.name,
    transition,
    value,
    paged,
    severityUpdate: edge === "update",
  };
}

async function notifyTransition(
  db: Database,
  send: SlackSender,
  input: {
    monitor: typeof monitors.$inferSelect;
    jobId: string;
    transition: SlackTransition;
    tags: Tags;
    conditionKeys: string[];
    value: number;
    window: { start: Date; end: Date };
    severity: SeverityLevel | null;
    firedAt: Date;
    emittedAt: Date;
    options: EvaluateOptions;
  },
): Promise<void> {
  const { monitor, jobId, transition, tags, conditionKeys, value, window, severity, firedAt, emittedAt, options } =
    input;
  await db.insert(notifications).values({
    monitorId: monitor.id,
    tags,
    transition,
    value,
  });
  if (monitor.notifyMode === "webhook") {
    try {
      const event = buildC3AlertEvent({
        monitorId: monitor.id,
        monitorName: monitor.name,
        jobId,
        transition,
        tags,
        conditionTagKeys: conditionKeys,
        value,
        metricName: monitor.metricName,
        threshold: monitor.threshold,
        consecutivePoints: monitor.consecutivePoints,
        windowStart: window.start,
        windowEnd: window.end,
        team: monitor.team,
        manualUrl: monitor.manualUrl,
        severity,
        firedAt,
        emittedAt,
      });
      await deliverC3Alert(event, {
        baseUrl: options.p8AlertUrl ?? monitor.alertWebhook,
        send: options.deliverAlert,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Alert webhook delivery failed";
      console.error(`[c3] ${transition} for monitor ${monitor.id}: ${detail}`);
    }
  } else {
    await send({
      webhookUrl: monitor.slackWebhook,
      text: slackText({
        monitorName: monitor.name,
        transition,
        value,
        tags,
        metricName: monitor.metricName,
        threshold: monitor.threshold,
        consecutivePoints: monitor.consecutivePoints,
        windowStart: window.start,
        windowEnd: window.end,
        manualUrl: monitor.manualUrl,
        severity,
      }),
    });
  }
}

async function readSeriesTransition(
  db: Database,
  jobId: string,
  monitor: typeof monitors.$inferSelect,
  tags: Tags,
  key: string,
) {
  const recent = await db
    .select({
      value: points.value,
      time: points.time,
      windowStart: runs.windowStart,
      windowEnd: runs.windowEnd,
    })
    .from(points)
    .leftJoin(runs, eq(points.runId, runs.id))
    .where(and(eq(points.jobId, jobId), eq(points.metricName, monitor.metricName), eq(points.tags, tags)))
    .orderBy(desc(points.time))
    .limit(monitor.consecutivePoints);
  const next: SeriesStatus =
    recent.length === monitor.consecutivePoints && recent.every((row) => row.value >= monitor.threshold)
      ? "alert"
      : "ok";
  const [current] = await db
    .select({
      status: monitorStates.status,
      alertOpenedAt: monitorStates.alertOpenedAt,
      pageSeverity: monitorStates.pageSeverity,
    })
    .from(monitorStates)
    .where(and(eq(monitorStates.monitorId, monitor.id), eq(monitorStates.seriesKey, key)));
  const previous: SeriesStatus = current?.status ?? "ok";
  return { next, previous, recent, current };
}

async function upsertMonitorState(
  db: Database,
  row: {
    monitorId: string;
    seriesKey: string;
    tags: Tags;
    status: SeriesStatus;
    value: number;
    alertOpenedAt: Date | null;
    pageSeverity: SeverityLevel | null;
  },
): Promise<void> {
  await db
    .insert(monitorStates)
    .values({
      monitorId: row.monitorId,
      seriesKey: row.seriesKey,
      tags: row.tags,
      status: row.status,
      value: row.value,
      alertOpenedAt: row.alertOpenedAt,
      pageSeverity: row.pageSeverity,
    })
    .onConflictDoUpdate({
      target: [monitorStates.monitorId, monitorStates.seriesKey],
      set: {
        tags: row.tags,
        status: row.status,
        value: row.value,
        alertOpenedAt: row.alertOpenedAt,
        pageSeverity: row.pageSeverity,
        updatedAt: new Date(),
      },
    });
}

function pickDrivingMember(
  alertMembers: (typeof monitorStates.$inferSelect)[],
  severityConfig: ReturnType<typeof normalizeSeverityConfig>,
): typeof monitorStates.$inferSelect {
  let best = alertMembers[0]!;
  let bestRank = severityRank(resolveSeverity(severityConfig, best.tags));
  for (let i = 1; i < alertMembers.length; i += 1) {
    const row = alertMembers[i]!;
    const rank = severityRank(resolveSeverity(severityConfig, row.tags));
    if (rank > bestRank) {
      best = row;
      bestRank = rank;
    }
  }
  return best;
}

function severityRank(level: SeverityLevel | null): number {
  if (level === "critical") {
    return 3;
  }
  if (level === "warning") {
    return 2;
  }
  if (level === "info") {
    return 1;
  }
  return 0;
}

function parseStoredSeverity(value: string | null | undefined): SeverityLevel | null {
  return isSeverityLevel(value) ? value : null;
}

async function hasUnmatchedFiring(
  db: Database,
  monitorId: string,
  identity: Tags,
  conditionKeys: string[],
): Promise<boolean> {
  const rows = await db
    .select({ transition: notifications.transition, tags: notifications.tags })
    .from(notifications)
    .where(eq(notifications.monitorId, monitorId))
    .orderBy(desc(notifications.createdAt));
  for (const row of rows) {
    if (!tagMapsEqual(identityTagsFrom(row.tags, conditionKeys), identity)) {
      continue;
    }
    return row.transition === "firing";
  }
  return false;
}

function tagMapsEqual(left: Tags, right: Tags): boolean {
  return JSON.stringify(normalizeTags(left)) === JSON.stringify(normalizeTags(right));
}

function readJobIdFromSeriesKey(key: string): string | undefined {
  try {
    const parsed = JSON.parse(key) as { jobId?: unknown };
    return typeof parsed.jobId === "string" ? parsed.jobId : undefined;
  } catch {
    return undefined;
  }
}

function windowBounds(
  recent: { time: Date; windowStart: Date | null; windowEnd: Date | null }[],
  fallback: Date,
): { start: Date; end: Date } {
  if (recent.length === 0) {
    return { start: fallback, end: fallback };
  }
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const row of recent) {
    const rowStart = (row.windowStart ?? row.time).getTime();
    const rowEnd = (row.windowEnd ?? row.time).getTime();
    start = Math.min(start, rowStart);
    end = Math.max(end, rowEnd);
  }
  return { start: new Date(start), end: new Date(end) };
}

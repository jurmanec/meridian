import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { Database } from "./client";
import { connections, jobs, monitorJobs, monitors, monitorStates, notifications, points, reductions, runs, type DynamicTag, type RunStatus, type Tags, type WindowMode } from "./schema";
import { isIncidentSeriesKey } from "@/monitor/message";
import { metricNameFor } from "@/sources/dynamodb/items";
import { normalizeDynamicTags, sameDynamicTags } from "./dynamic-tags";
import { normalizeSeverityConfig, type SeverityConfig } from "./severity";
import { normalizeTagFilter, normalizeTags } from "./tags";

export type NewConnection = {
  name: string;
  sourceType: string;
  secretRef: string;
  secret?: string;
  config?: Record<string, unknown>;
};

export type NewReduction = {
  aggregation: string;
  metricName: string;
  field?: string | null;
  filter?: Record<string, unknown> | null;
};

export type NewJob = {
  name: string;
  connectionId: string;
  query: Record<string, unknown>;
  windowMode?: WindowMode;
  maxLookbackSeconds?: number;
  intervalSeconds: number;
  cron?: string;
  dynamicTags?: DynamicTag[] | string[];
  staticTags?: Tags;
  enabled?: boolean;
  reductions: NewReduction[];
};

export type NewRun = {
  jobId: string;
  windowStart: Date;
  windowEnd: Date;
  status: RunStatus;
  error?: string | null;
};

export type NewPoint = {
  time: Date;
  jobId: string;
  metricName: string;
  tags: Tags;
  value: number;
  runId?: string | null;
};

export type PointIdentity = {
  time: Date;
  jobId: string;
  metricName: string;
  tags: Tags;
};

export async function createConnection(db: Database, input: NewConnection) {
  const [row] = await db
    .insert(connections)
    .values({
      name: input.name,
      sourceType: input.sourceType,
      secretRef: input.secretRef,
      secret: input.secret ?? "",
      config: input.config ?? {},
    })
    .returning();
  return row;
}

export async function updateConnection(
  db: Database,
  id: string,
  input: { name: string; sourceType: string; config: Record<string, unknown>; secret?: string },
) {
  const [row] = await db
    .update(connections)
    .set({
      name: input.name,
      sourceType: input.sourceType,
      config: input.config,
      ...(input.secret === undefined ? {} : { secret: input.secret }),
    })
    .where(eq(connections.id, id))
    .returning();
  if (!row) {
    throw new Error("Connection not found");
  }
  return row;
}

export async function createJob(db: Database, input: NewJob) {
  if (input.reductions.length === 0) {
    throw new Error("A job needs at least one reduction");
  }
  const named = namedReductions(input.reductions);
  const metricNames = named.map((reduction) => reduction.metricName);
  if (new Set(metricNames).size !== metricNames.length) {
    throw new Error("Each reduction on a job needs its own metric name");
  }
  const jobInput = { ...input, reductions: named };

  return db.transaction(async (tx) => {
    await assertDistinctSeries(tx as Database, jobInput);
    const [job] = await tx
      .insert(jobs)
      .values({
        name: jobInput.name,
        connectionId: jobInput.connectionId,
        query: jobInput.query,
        windowMode: jobInput.windowMode ?? "since_last_run",
        maxLookbackSeconds: jobInput.maxLookbackSeconds ?? 86_400,
        intervalSeconds: jobInput.intervalSeconds,
        cron: jobInput.cron ?? "",
        dynamicTags: normalizeDynamicTags(jobInput.dynamicTags ?? []),
        staticTags: normalizeTags(jobInput.staticTags ?? {}),
        enabled: jobInput.enabled ?? true,
      })
      .returning();

    const storedReductions = await tx
      .insert(reductions)
      .values(
        named.map((reduction, position) => ({
          jobId: job.id,
          position,
          aggregation: reduction.aggregation,
          metricName: reduction.metricName,
          field: reduction.field ?? null,
          filter: reduction.filter ?? null,
        })),
      )
      .returning();

    return { job, reductions: storedReductions };
  });
}

export async function updateJob(db: Database, jobId: string, input: NewJob) {
  if (input.reductions.length === 0) {
    throw new Error("A job needs at least one reduction");
  }
  const named = namedReductions(input.reductions);
  const metricNames = named.map((reduction) => reduction.metricName);
  if (new Set(metricNames).size !== metricNames.length) {
    throw new Error("Each reduction on a job needs its own metric name");
  }
  const jobInput = { ...input, reductions: named };

  return db.transaction(async (tx) => {
    await assertDistinctSeries(tx as Database, jobInput, jobId);
    const [job] = await tx
      .update(jobs)
      .set({
        name: jobInput.name,
        connectionId: jobInput.connectionId,
        query: jobInput.query,
        windowMode: jobInput.windowMode ?? "since_last_run",
        maxLookbackSeconds: jobInput.maxLookbackSeconds ?? 86_400,
        intervalSeconds: jobInput.intervalSeconds,
        cron: jobInput.cron ?? "",
        dynamicTags: normalizeDynamicTags(jobInput.dynamicTags ?? []),
        staticTags: normalizeTags(jobInput.staticTags ?? {}),
      })
      .where(eq(jobs.id, jobId))
      .returning();
    if (!job) {
      throw new Error("Job not found");
    }

    await tx.delete(reductions).where(eq(reductions.jobId, jobId));
    const storedReductions = await tx
      .insert(reductions)
      .values(
        named.map((reduction, position) => ({
          jobId,
          position,
          aggregation: reduction.aggregation,
          metricName: reduction.metricName,
          field: reduction.field ?? null,
          filter: reduction.filter ?? null,
        })),
      )
      .returning();

    return { job, reductions: storedReductions };
  });
}

function namedReductions(input: NewReduction[]): NewReduction[] {
  return input.map((reduction) => ({
    ...reduction,
    metricName: metricNameFor(reduction.aggregation, reduction.field),
  }));
}

async function assertDistinctSeries(db: Database, input: NewJob, exceptJobId?: string) {
  const metricNames = input.reductions.map((reduction) => reduction.metricName);
  const staticTags = normalizeTags(input.staticTags ?? {});
  const dynamicTags = normalizeDynamicTags(input.dynamicTags ?? []);
  const rows = await db
    .select({
      id: jobs.id,
      name: jobs.name,
      staticTags: jobs.staticTags,
      dynamicTags: jobs.dynamicTags,
      metricName: reductions.metricName,
    })
    .from(jobs)
    .innerJoin(reductions, eq(reductions.jobId, jobs.id))
    .where(exceptJobId ? and(inArray(reductions.metricName, metricNames), ne(jobs.id, exceptJobId)) : inArray(reductions.metricName, metricNames));

  const matches = new Map<string, { name: string; metrics: string[] }>();
  for (const row of rows) {
    if (!sameTags(row.staticTags, staticTags) || !sameDynamicTags(row.dynamicTags, dynamicTags)) {
      continue;
    }
    const match = matches.get(row.id) ?? { name: row.name, metrics: [] };
    match.metrics.push(row.metricName);
    matches.set(row.id, match);
  }
  if (matches.size === 0) {
    return;
  }
  const detail = [...matches.values()]
    .map((match) => `A job already writes ${match.metrics.sort().join(", ")} with these tags: ${match.name}.`)
    .join(" ");
  throw new Error(detail);
}

function sameTags(left: Tags, right: Tags): boolean {
  return JSON.stringify(normalizeTags(left)) === JSON.stringify(normalizeTags(right));
}

export async function createRun(db: Database, input: NewRun) {
  const [row] = await db
    .insert(runs)
    .values({
      jobId: input.jobId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      status: input.status,
      error: input.error ?? null,
    })
    .returning();
  return row;
}

export async function writePoint(db: Database, input: NewPoint) {
  const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, input.jobId));
  if (!job) {
    throw new Error("Point job does not exist");
  }

  const tags = normalizeTags(input.tags);
  const [row] = await db
    .insert(points)
    .values({
      time: input.time,
      jobId: input.jobId,
      metricName: input.metricName,
      tags,
      value: input.value,
      runId: input.runId ?? null,
    })
    .returning();
  return row;
}

export async function readPoint(db: Database, identity: PointIdentity) {
  const [row] = await db
    .select()
    .from(points)
    .where(
      and(
        eq(points.time, identity.time),
        eq(points.jobId, identity.jobId),
        eq(points.metricName, identity.metricName),
        eq(points.tags, normalizeTags(identity.tags)),
      ),
    );
  return row ?? null;
}

export async function getConnection(db: Database, id: string) {
  const [row] = await db.select().from(connections).where(eq(connections.id, id));
  return row ?? null;
}

export async function listConnections(db: Database) {
  return db
    .select({
      id: connections.id,
      name: connections.name,
      sourceType: connections.sourceType,
      config: connections.config,
      createdAt: connections.createdAt,
    })
    .from(connections)
    .orderBy(desc(connections.createdAt));
}

export async function listJobs(db: Database) {
  return db
    .select({
      id: jobs.id,
      name: jobs.name,
      intervalSeconds: jobs.intervalSeconds,
      windowMode: jobs.windowMode,
      enabled: jobs.enabled,
      health: jobs.health,
      connectionName: connections.name,
    })
    .from(jobs)
    .innerJoin(connections, eq(jobs.connectionId, connections.id))
    .orderBy(desc(jobs.createdAt));
}

export async function getJobDetail(db: Database, jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) {
    return null;
  }

  const [connection] = await db
    .select({
      id: connections.id,
      name: connections.name,
      sourceType: connections.sourceType,
    })
    .from(connections)
    .where(eq(connections.id, job.connectionId));

  const reductionRows = await db
    .select()
    .from(reductions)
    .where(eq(reductions.jobId, jobId))
    .orderBy(asc(reductions.position));

  const runRows = await db
    .select()
    .from(runs)
    .where(eq(runs.jobId, jobId))
    .orderBy(desc(runs.createdAt))
    .limit(50);

  const pointRows = await db
    .select()
    .from(points)
    .where(eq(points.jobId, jobId))
    .orderBy(desc(points.time))
    .limit(50);

  return {
    job,
    connection,
    reductions: reductionRows,
    runs: runRows,
    points: pointRows,
  };
}

export type NewMonitor = {
  name: string;
  jobId?: string;
  jobIds?: string[];
  metricName: string;
  tagFilter?: Record<string, string | string[]>;
  threshold: number;
  severity: SeverityConfig | string;
  team: string;
  manualUrl?: string;
  notifyMode?: "slack" | "webhook";
  slackWebhook?: string;
  alertWebhook?: string;
  consecutivePoints?: number;
};

export async function createMonitor(db: Database, input: NewMonitor) {
  const jobIds = [...new Set([...(input.jobIds ?? []), ...(input.jobId ? [input.jobId] : [])])];
  if (jobIds.length === 0) {
    throw new Error("A monitor needs a job.");
  }
  const tagFilter = normalizeTagFilter(input.tagFilter ?? {});
  const severity = normalizeSeverityConfig(input.severity);
  const notifyMode = input.notifyMode === "webhook" ? "webhook" : "slack";
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(monitors)
      .values({
        name: input.name,
        metricName: input.metricName,
        tagFilter,
        threshold: input.threshold,
        severity,
        team: input.team,
        manualUrl: input.manualUrl ?? "",
        notifyMode,
        slackWebhook: notifyMode === "slack" ? (input.slackWebhook ?? "") : "",
        alertWebhook: notifyMode === "webhook" ? (input.alertWebhook ?? "") : "",
        consecutivePoints: input.consecutivePoints ?? 1,
      })
      .returning({ id: monitors.id });
    await tx.insert(monitorJobs).values(jobIds.map((jobId) => ({ monitorId: row.id, jobId })));
    return row;
  });
}

export async function updateMonitor(
  db: Database,
  monitorId: string,
  input: Omit<NewMonitor, "slackWebhook" | "alertWebhook"> & {
    slackWebhook?: string;
    alertWebhook?: string;
  },
) {
  const jobIds = [...new Set([...(input.jobIds ?? []), ...(input.jobId ? [input.jobId] : [])])];
  if (jobIds.length === 0) {
    throw new Error("A monitor needs a job.");
  }
  const tagFilter = normalizeTagFilter(input.tagFilter ?? {});
  const severity = normalizeSeverityConfig(input.severity);
  const consecutivePoints = input.consecutivePoints ?? 1;
  const notifyMode = input.notifyMode === "webhook" ? "webhook" : "slack";
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(monitors).where(eq(monitors.id, monitorId));
    if (!existing) {
      throw new Error("Monitor not found");
    }
    const previous = await tx.select({ jobId: monitorJobs.jobId }).from(monitorJobs).where(eq(monitorJobs.monitorId, monitorId));
    const sameJobs = previous.map((row) => row.jobId).sort().join() === [...jobIds].sort().join();
    const sameCondition = sameJobs
      && existing.metricName === input.metricName
      && existing.threshold === input.threshold
      && existing.consecutivePoints === consecutivePoints
      && JSON.stringify(existing.tagFilter) === JSON.stringify(tagFilter);
    const slackWebhook =
      notifyMode === "slack"
        ? (input.slackWebhook === undefined ? existing.slackWebhook : input.slackWebhook)
        : "";
    const alertWebhook =
      notifyMode === "webhook"
        ? (input.alertWebhook === undefined ? existing.alertWebhook : input.alertWebhook)
        : "";
    const [row] = await tx
      .update(monitors)
      .set({
        name: input.name,
        metricName: input.metricName,
        tagFilter,
        threshold: input.threshold,
        severity,
        team: input.team,
        manualUrl: input.manualUrl ?? "",
        notifyMode,
        slackWebhook,
        alertWebhook,
        consecutivePoints,
      })
      .where(eq(monitors.id, monitorId))
      .returning({ id: monitors.id });
    if (!sameCondition) {
      await tx.delete(monitorStates).where(eq(monitorStates.monitorId, monitorId));
    }
    await tx.delete(monitorJobs).where(eq(monitorJobs.monitorId, monitorId));
    await tx.insert(monitorJobs).values(jobIds.map((jobId) => ({ monitorId, jobId })));
    return row;
  });
}

export async function listJobsForMonitors(db: Database) {
  const jobRows = await db.select({ id: jobs.id, name: jobs.name, staticTags: jobs.staticTags }).from(jobs).orderBy(desc(jobs.createdAt));
  const reductionRows = await db
    .select({ jobId: reductions.jobId, metricName: reductions.metricName })
    .from(reductions)
    .orderBy(asc(reductions.position));
  return jobRows.map((job) => ({
    id: job.id,
    name: job.name,
    staticTags: job.staticTags,
    metrics: reductionRows.filter((reduction) => reduction.jobId === job.id).map((reduction) => reduction.metricName),
  }));
}

export async function listMonitors(db: Database) {
  const rows = await db
    .select({
      id: monitors.id,
      name: monitors.name,
      metricName: monitors.metricName,
    })
    .from(monitors)
    .orderBy(desc(monitors.createdAt));
  const links = await db
    .select({ monitorId: monitorJobs.monitorId, jobName: jobs.name })
    .from(monitorJobs)
    .innerJoin(jobs, eq(monitorJobs.jobId, jobs.id));
  const states = await db.select({ monitorId: monitorStates.monitorId, status: monitorStates.status }).from(monitorStates);
  return rows.map((row) => ({
    ...row,
    jobNames: links.filter((link) => link.monitorId === row.id).map((link) => link.jobName).sort(),
    alerting: states.some((state) => state.monitorId === row.id && state.status === "alert"),
  }));
}

export async function getMonitorDetail(db: Database, monitorId: string) {
  const [monitor] = await db
    .select({
      id: monitors.id,
      name: monitors.name,
      metricName: monitors.metricName,
      tagFilter: monitors.tagFilter,
      threshold: monitors.threshold,
      severity: monitors.severity,
      team: monitors.team,
      manualUrl: monitors.manualUrl,
      notifyMode: monitors.notifyMode,
      slackWebhook: monitors.slackWebhook,
      alertWebhook: monitors.alertWebhook,
      consecutivePoints: monitors.consecutivePoints,
    })
    .from(monitors)
    .where(eq(monitors.id, monitorId));
  if (!monitor) {
    return null;
  }
  const linkedJobs = await db
    .select({ id: jobs.id, name: jobs.name, enabled: jobs.enabled })
    .from(monitorJobs)
    .innerJoin(jobs, eq(monitorJobs.jobId, jobs.id))
    .where(eq(monitorJobs.monitorId, monitorId))
    .orderBy(asc(jobs.name));
  const states = (
    await db
      .select()
      .from(monitorStates)
      .where(eq(monitorStates.monitorId, monitorId))
      .orderBy(asc(monitorStates.seriesKey))
  ).filter((state) => !isIncidentSeriesKey(state.seriesKey));
  const sent = await db
    .select()
    .from(notifications)
    .where(eq(notifications.monitorId, monitorId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  return { monitor: { ...monitor, jobs: linkedJobs }, states, notifications: sent };
}

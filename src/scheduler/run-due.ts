import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { connections, jobs, monitorJobs, monitors, monitorStates, points, reductions, runs } from "@/db/schema";
import { createRun, writePoint } from "@/db/store";
import { absentConditionZeros, conditionTagKeys, normalizeDynamicTags } from "@/db/dynamic-tags";
import type { DynamicTag, Tags, WindowMode } from "@/db/schema";
import { normalizeTags } from "@/db/tags";
import { evaluateMonitors, type EvaluateOptions, type MonitorTransition } from "@/monitor/evaluate";
import { isIncidentSeriesKey, readSeriesJobId } from "@/monitor/message";
import { postSlack, type SlackSender } from "@/monitor/slack";
import { latestCronSlot } from "./cron";
import { RETRY_ATTEMPTS, type ConnectorRegistry, type SourcePoint } from "./source";
import { computeWindow } from "./window";

export type JobRunResult = {
  status: "success" | "failed" | "skipped";
  windowStart: Date;
  windowEnd: Date;
  error: string;
  points: SourcePoint[];
  transitions: MonitorTransition[];
};

type RunnableJob = {
  id: string;
  intervalSeconds: number;
  maxLookbackSeconds: number;
  windowMode: WindowMode;
  cron: string;
  dynamicTags: DynamicTag[] | string[];
  query: Record<string, unknown>;
  staticTags: Record<string, string>;
  sourceType: string;
  connectionConfig: Record<string, unknown>;
  connectionSecret: string;
};

export async function runDueJobs(
  db: Database,
  now: Date,
  connectors: ConnectorRegistry = new Map(),
  onlyJobId?: string,
  sendOrOptions: SlackSender | EvaluateOptions = postSlack,
): Promise<void> {
  const options: EvaluateOptions =
    typeof sendOrOptions === "function" ? { send: sendOrOptions } : sendOrOptions;
  const dueJobs = await db
    .select({
      id: jobs.id,
      intervalSeconds: jobs.intervalSeconds,
      maxLookbackSeconds: jobs.maxLookbackSeconds,
      windowMode: jobs.windowMode,
      cron: jobs.cron,
      dynamicTags: jobs.dynamicTags,
      query: jobs.query,
      staticTags: jobs.staticTags,
      sourceType: connections.sourceType,
      connectionConfig: connections.config,
      connectionSecret: connections.secret,
    })
    .from(jobs)
    .innerJoin(connections, eq(jobs.connectionId, connections.id))
    .where(onlyJobId ? and(eq(jobs.enabled, true), eq(jobs.id, onlyJobId)) : eq(jobs.enabled, true));

  for (const job of dueJobs) {
    if (!(await isDue(db, job.id, job.intervalSeconds, job.cron, now))) {
      continue;
    }
    await runJob(db, job, now, connectors, options);
  }
}

async function isDue(db: Database, jobId: string, intervalSeconds: number, cron: string, now: Date): Promise<boolean> {
  const [latest] = await db
    .select({ windowEnd: runs.windowEnd })
    .from(runs)
    .where(eq(runs.jobId, jobId))
    .orderBy(desc(runs.windowEnd))
    .limit(1);
  if (cron.trim()) {
    const slot = latestCronSlot(cron, now);
    if (!slot) {
      return false;
    }
    return !latest || new Date(latest.windowEnd).getTime() < slot.getTime();
  }
  if (!latest) {
    return true;
  }
  return now.getTime() >= new Date(latest.windowEnd).getTime() + intervalSeconds * 1000;
}

export async function nextCollectionWindow(db: Database, jobId: string, now: Date): Promise<{ start: Date; end: Date; canRun: boolean; reason: string } | null> {
  const job = await loadRunnableJob(db, jobId);
  if (!job) {
    return null;
  }
  const window = await resolveWindow(db, job, now);
  return { start: window.start, end: window.end, canRun: window.reason.length === 0, reason: window.reason };
}

export async function runJobNow(
  db: Database,
  jobId: string,
  now: Date,
  connectors: ConnectorRegistry = new Map(),
  sendOrOptions: SlackSender | EvaluateOptions = postSlack,
): Promise<JobRunResult> {
  const options: EvaluateOptions =
    typeof sendOrOptions === "function" ? { send: sendOrOptions } : sendOrOptions;
  const job = await loadRunnableJob(db, jobId);
  if (!job) {
    return { status: "failed", windowStart: now, windowEnd: now, error: "Job not found", points: [], transitions: [] };
  }
  return runJob(db, job, now, connectors, options);
}

async function loadRunnableJob(db: Database, jobId: string): Promise<RunnableJob | undefined> {
  const [job] = await db
    .select({
      id: jobs.id,
      intervalSeconds: jobs.intervalSeconds,
      maxLookbackSeconds: jobs.maxLookbackSeconds,
      windowMode: jobs.windowMode,
      cron: jobs.cron,
      dynamicTags: jobs.dynamicTags,
      query: jobs.query,
      staticTags: jobs.staticTags,
      sourceType: connections.sourceType,
      connectionConfig: connections.config,
      connectionSecret: connections.secret,
    })
    .from(jobs)
    .innerJoin(connections, eq(jobs.connectionId, connections.id))
    .where(eq(jobs.id, jobId));
  return job;
}

async function resolveWindow(db: Database, job: RunnableJob, now: Date): Promise<{ start: Date; end: Date; reason: string }> {
  const [lastSuccess] = await db
    .select({ windowEnd: runs.windowEnd })
    .from(runs)
    .where(and(eq(runs.jobId, job.id), eq(runs.status, "success")))
    .orderBy(desc(runs.windowEnd))
    .limit(1);
  const tick = job.cron.trim() ? latestCronSlot(job.cron, now) ?? now : now;
  const window = computeWindow({
    now: tick,
    mode: job.windowMode,
    maxLookbackSeconds: job.maxLookbackSeconds,
    lastSuccessEnd: lastSuccess?.windowEnd ?? null,
  });
  if (window.end.getTime() <= window.start.getTime()) {
    return { ...window, reason: "This window is empty." };
  }
  if (lastSuccess && window.end.getTime() <= new Date(lastSuccess.windowEnd).getTime()) {
    return { ...window, reason: "This window was already collected." };
  }
  return { ...window, reason: "" };
}

async function runJob(
  db: Database,
  job: RunnableJob,
  now: Date,
  connectors: ConnectorRegistry,
  options: EvaluateOptions,
): Promise<JobRunResult> {
  // #region agent log
  fetch('http://127.0.0.1:7319/ingest/3cbdfb72-711e-481d-a01f-d1a45d208eb5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99d71f'},body:JSON.stringify({sessionId:'99d71f',runId:'pre-fix',hypothesisId:'C',location:'run-due.ts:runJob-entry',message:'runJob started',data:{jobId:job.id,jobName:job.name,query:job.query,staticTags:job.staticTags},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const window = await resolveWindow(db, job, now);
  if (window.reason) {
    return { status: "skipped", windowStart: window.start, windowEnd: window.end, error: window.reason, points: [], transitions: [] };
  }

  const reductionRows = await db
    .select({ aggregation: reductions.aggregation, metricName: reductions.metricName, field: reductions.field, filter: reductions.filter })
    .from(reductions)
    .where(eq(reductions.jobId, job.id));

  const dynamicTags = normalizeDynamicTags(job.dynamicTags);
  let points: SourcePoint[] | undefined;
  let failure: unknown;
  const connector = connectors.get(job.sourceType);
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    try {
      if (!connector) {
        throw new Error(`Source ${job.sourceType} cannot run`);
      }
      points = await connector.run({
        sourceType: job.sourceType,
        query: job.query,
        reductions: reductionRows,
        dynamicTags,
        staticTags: job.staticTags,
        windowStart: window.start,
        windowEnd: window.end,
        connection: {
          config: job.connectionConfig,
          secret: job.connectionSecret,
        },
      });
      if (points.length === 0) {
        throw new Error(`Source ${job.sourceType} returned no points`);
      }
      failure = undefined;
      break;
    } catch (error) {
      failure = error;
      points = undefined;
    }
  }

  if (points) {
    const prepared = points.map((point) => ({
      metricName: point.metricName,
      value: point.value,
      tags: normalizeTags({ ...point.tags, ...job.staticTags }),
    }));
    // #region agent log
    fetch('http://127.0.0.1:7319/ingest/3cbdfb72-711e-481d-a01f-d1a45d208eb5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99d71f'},body:JSON.stringify({sessionId:'99d71f',runId:'pre-fix',hypothesisId:'A_B',location:'run-due.ts:tag-merge',message:'job tags merged onto points',data:{jobId:job.id,query:job.query,staticTags:job.staticTags,rawPointTags:points.map((p)=>p.tags),mergedPointTags:prepared.map((p)=>p.tags)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const conditionKeys = conditionTagKeys(dynamicTags);
    const prior = conditionKeys.length > 0 ? await loadZeroFillCandidates(db, job.id) : [];
    const zeros = conditionKeys.length > 0 ? absentConditionZeros(prepared, prior, conditionKeys) : [];
    points = [...prepared, ...zeros];
  }

  await db.transaction(async (tx) => {
    if (points) {
      const run = await createRun(tx as Database, {
        jobId: job.id,
        windowStart: window.start,
        windowEnd: window.end,
        status: "success",
      });
      for (const point of points) {
        await writePoint(tx as Database, {
          time: window.end,
          jobId: job.id,
          metricName: point.metricName,
          value: point.value,
          tags: point.tags,
          runId: run.id,
        });
      }
      await tx.update(jobs).set({ health: "ok" }).where(eq(jobs.id, job.id));
      return;
    }

    await createRun(tx as Database, {
      jobId: job.id,
      windowStart: window.start,
      windowEnd: window.end,
      status: "failed",
      error: failure instanceof Error ? failure.message : "Run failed",
    });
    await tx.update(jobs).set({ health: "failing" }).where(eq(jobs.id, job.id));
  });

  if (!points) {
    return {
      status: "failed",
      windowStart: window.start,
      windowEnd: window.end,
      error: failure instanceof Error ? failure.message : "Run failed",
      points: [],
      transitions: [],
    };
  }
  const written = points;
  try {
    const transitions = await evaluateMonitors(
      db,
      job.id,
      written.map((point) => ({ ...point, time: window.end })),
      options,
    );
    return { status: "success", windowStart: window.start, windowEnd: window.end, error: "", points: written, transitions };
  } catch (error) {
    console.error("monitor evaluation failed", error);
    return {
      status: "success",
      windowStart: window.start,
      windowEnd: window.end,
      error: "The points were stored, and monitor evaluation failed.",
      points: written,
      transitions: [],
    };
  }
}

async function loadZeroFillCandidates(db: Database, jobId: string): Promise<{ metricName: string; tags: Tags }[]> {
  const byKey = new Map<string, { metricName: string; tags: Tags }>();
  const add = (metricName: string, tags: Tags) => {
    const normalized = normalizeTags(tags);
    byKey.set(JSON.stringify({ metricName, tags: normalized }), { metricName, tags: normalized });
  };

  const [lastSuccess] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.jobId, jobId), eq(runs.status, "success")))
    .orderBy(desc(runs.windowEnd))
    .limit(1);
  if (lastSuccess) {
    const rows = await db
      .select({ metricName: points.metricName, tags: points.tags })
      .from(points)
      .where(eq(points.runId, lastSuccess.id));
    for (const row of rows) {
      add(row.metricName, row.tags);
    }
  }

  const alertRows = await db
    .select({
      metricName: monitors.metricName,
      tags: monitorStates.tags,
      seriesKey: monitorStates.seriesKey,
    })
    .from(monitorStates)
    .innerJoin(monitors, eq(monitors.id, monitorStates.monitorId))
    .innerJoin(monitorJobs, eq(monitorJobs.monitorId, monitors.id))
    .where(and(eq(monitorJobs.jobId, jobId), eq(monitorStates.status, "alert")));
  for (const row of alertRows) {
    if (isIncidentSeriesKey(row.seriesKey)) {
      continue;
    }
    const seriesJobId = readSeriesJobId(row.seriesKey);
    if (seriesJobId && seriesJobId !== jobId) {
      continue;
    }
    add(row.metricName, row.tags);
  }

  return [...byKey.values()];
}

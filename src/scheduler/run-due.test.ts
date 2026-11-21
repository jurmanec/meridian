import { eq, sql } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { connections, jobs, points, runs } from "@/db/schema";
import { createConnection, createJob } from "@/db/store";
import { runDueJobs, runJobNow } from "./run-due";
import type { ConnectorRegistry } from "./source";

afterAll(async () => {
  await closeDb();
});

test("a short interval records a run each due tick, and a source that cannot run leaves the cursor", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;
  const attempts = { count: 0 };
  const failing: ConnectorRegistry = new Map([
    [
      "dynamodb",
      {
        run() {
          attempts.count += 1;
          throw new Error("Source dynamodb cannot run");
        },
      },
    ],
  ]);

  try {
    const connection = await createConnection(db, {
      name: `sched-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `tick-${suffix}`,
      connectionId: connection.id,
      query: {},
      intervalSeconds: 2,
      staticTags: { run: suffix },
      reductions: [{ aggregation: "count", metricName: "facility_faulted_count" }],
    });
    jobId = job.id;

    const first = new Date("2026-11-13T16:00:00.000Z");
    await runDueJobs(db, first, failing, job.id);
    await runDueJobs(db, new Date(first.getTime() + 1000), failing, job.id);
    await runDueJobs(db, new Date(first.getTime() + 2000), failing, job.id);

    const recorded = await db.select().from(runs).where(eq(runs.jobId, job.id));
    const written = await db.select().from(points).where(eq(points.jobId, job.id));
    const [stored] = await db.select({ health: jobs.health }).from(jobs).where(eq(jobs.id, job.id));
    const successes = recorded.filter((run) => run.status === "success");

    expect(attempts.count).toBe(6);
    expect(recorded).toHaveLength(2);
    expect(recorded.every((run) => run.status === "failed")).toBe(true);
    expect(written).toHaveLength(0);
    expect(successes).toHaveLength(0);
    expect(stored?.health).toBe("failing");
  } finally {
    if (jobId) {
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

test("the success cursor advances only after a point is written", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;

  try {
    const connection = await createConnection(db, {
      name: `cursor-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `cursor-job-${suffix}`,
      connectionId: connection.id,
      query: {},
      intervalSeconds: 1,
      staticTags: { asset_id: "CRAH-01" },
      reductions: [{ aggregation: "count", metricName: `cursor-${suffix}` }],
    });
    jobId = job.id;

    const first = new Date("2026-11-13T16:00:00.000Z");
    const writing: ConnectorRegistry = new Map([
      [
        "dynamodb",
        {
          async run() {
            return [{ metricName: "facility_faulted_count", value: 0, tags: {} }];
          },
        },
      ],
    ]);
    await runDueJobs(db, first, writing, job.id);
    const [cursor] = await db.execute<{ window_end: Date }>(
      sql`select max(window_end) as window_end from runs where job_id = ${job.id} and status = 'success'`,
    );

    const failing: ConnectorRegistry = new Map([
      [
        "dynamodb",
        {
          async run() {
            throw new Error("Source dynamodb cannot run");
          },
        },
      ],
    ]);
    await runDueJobs(db, new Date(first.getTime() + 1000), failing, job.id);

    const [after] = await db.execute<{ window_end: Date }>(
      sql`select max(window_end) as window_end from runs where job_id = ${job.id} and status = 'success'`,
    );
    const written = await db.select().from(points).where(eq(points.jobId, job.id));

    expect(new Date(cursor?.window_end ?? 0).toISOString()).toBe(first.toISOString());
    expect(new Date(after?.window_end ?? 0).toISOString()).toBe(first.toISOString());
    expect(written).toHaveLength(1);
    expect(written[0]?.value).toBe(0);
  } finally {
    if (jobId) {
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

test("run now collects a disabled job once and leaves the schedule off", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;
  const metric = `manual-${suffix}`;

  try {
    const connection = await createConnection(db, {
      name: `manual-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `manual-job-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = A" },
      intervalSeconds: 86400,
      enabled: false,
      staticTags: { asset_id: `MANUAL-${suffix}` },
      reductions: [{ aggregation: "count", metricName: metric }],
    });
    jobId = job.id;
    const now = new Date("2026-11-14T12:00:00.000Z");
    const connectors: ConnectorRegistry = new Map([
      [
        "dynamodb",
        {
          async run() {
            return [{ metricName: metric, value: 3, tags: {} }];
          },
        },
      ],
    ]);

    const collected = await runJobNow(db, job.id, now, connectors, async () => {});
    const again = await runJobNow(db, job.id, now, connectors, async () => {});
    const [stored] = await db.select({ enabled: jobs.enabled }).from(jobs).where(eq(jobs.id, job.id));
    const written = await db.select().from(points).where(eq(points.jobId, job.id));

    expect(collected.status).toBe("success");
    expect(collected.points).toEqual([{ metricName: metric, value: 3, tags: { asset_id: `MANUAL-${suffix}` } }]);
    expect(collected.transitions).toEqual([]);
    expect(again.status).toBe("skipped");
    expect(again.error).toBe("This window is empty.");
    expect(stored?.enabled).toBe(false);
    expect(written).toHaveLength(1);
  } finally {
    if (jobId) {
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

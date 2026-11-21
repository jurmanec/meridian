import { eq, sql } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { closeDb, getDb } from "./client";
import { connections, jobs, monitorJobs, monitors, points, reductions } from "./schema";
import { createConnection, createJob, createMonitor, createRun, readPoint, updateConnection, updateJob, updateMonitor, writePoint } from "./store";

afterAll(async () => {
  await closeDb();
});

test("saves a connection and a job, then reads a point back by job, metric, tags, and time", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;

  try {
    const connection = await createConnection(db, {
      name: `facility-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "env:FACILITY_TABLE",
      config: { region: "us-east-1", table: "facility" },
    });
    connectionId = connection.id;

    const { job, reductions: storedReductions } = await createJob(db, {
      name: `crah-faulted-${suffix}`,
      connectionId: connection.id,
      query: { partitionKey: "CRAH-01" },
      intervalSeconds: 300,
      staticTags: { asset_id: "CRAH-01", hall_id: "HALL-01" },
      reductions: [{ aggregation: "count", metricName: "facility_faulted_count" }],
    });
    jobId = job.id;

    const windowStart = new Date("2026-11-13T15:00:00.000Z");
    const windowEnd = new Date("2026-11-13T15:05:00.000Z");
    const run = await createRun(db, {
      jobId: job.id,
      windowStart,
      windowEnd,
      status: "success",
    });

    await writePoint(db, {
      time: windowEnd,
      jobId: job.id,
      metricName: "facility_faulted_count",
      tags: { hall_id: "HALL-01", asset_id: "CRAH-01" },
      value: 3,
      runId: run.id,
    });

    const point = await readPoint(db, {
      time: windowEnd,
      jobId: job.id,
      metricName: "facility_faulted_count",
      tags: { asset_id: "CRAH-01", hall_id: "HALL-01" },
    });

    const [hypertable] = await db.execute<{ hypertable_name: string }>(
      sql`select hypertable_name from timescaledb_information.hypertables where hypertable_name = 'points'`,
    );

    expect(job.windowMode).toBe("since_last_run");
    expect(job.maxLookbackSeconds).toBe(86_400);
    expect(job.staticTags).toEqual({ asset_id: "CRAH-01", hall_id: "HALL-01" });
    expect(storedReductions).toHaveLength(1);
    expect(storedReductions[0]?.metricName).toBe("row_count");
    expect(point).toMatchObject({
      jobId: job.id,
      metricName: "facility_faulted_count",
      value: 3,
      runId: run.id,
      tags: { asset_id: "CRAH-01", hall_id: "HALL-01" },
    });
    expect(point && new Date(point.time).toISOString()).toBe(windowEnd.toISOString());
    expect(hypertable?.hypertable_name).toBe("points");

    const updated = await updateJob(db, job.id, {
      name: `crah-faulted-edited-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = CRAH-01" },
      intervalSeconds: 600,
      reductions: [{ aggregation: "sum", metricName: "reading_sum", field: "reading" }],
    });
    const stored = await db.select().from(reductions).where(eq(reductions.jobId, job.id));
    expect(updated.job.name).toBe(`crah-faulted-edited-${suffix}`);
    expect(updated.job.query).toEqual({ text: "pk = CRAH-01" });
    expect(updated.job.intervalSeconds).toBe(600);
    expect(updated.job.enabled).toBe(true);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.metricName).toBe("reading_sum");
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

test("refuses a job that writes a metric another job already writes with the same tags", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  const metric = `series-${suffix}`;
  const tags = { asset_id: `ASSET-${suffix}`, hall_id: "HALL-01" };
  let connectionId: string | undefined;
  let otherConnectionId: string | undefined;
  const jobIds: string[] = [];

  try {
    const connection = await createConnection(db, {
      name: `series-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const other = await createConnection(db, {
      name: `series-other-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    otherConnectionId = other.id;

    const { job } = await createJob(db, {
      name: `original-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = ROOM-01" },
      intervalSeconds: 300,
      enabled: false,
      dynamicTags: ["hall", "asset"],
      staticTags: tags,
      reductions: [{ aggregation: "count", metricName: metric }],
    });
    jobIds.push(job.id);

    await expect(
      createJob(db, {
        name: `copy-${suffix}`,
        connectionId: other.id,
        query: { text: "pk = OTHER" },
        intervalSeconds: 600,
        dynamicTags: ["asset", "hall"],
        staticTags: { hall_id: "HALL-01", asset_id: `ASSET-${suffix}` },
        reductions: [{ aggregation: "count", metricName: "ignored" }],
      }),
    ).rejects.toThrow(`A job already writes row_count with these tags: original-${suffix}.`);

    const differentMetric = await createJob(db, {
      name: `other-metric-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = ROOM-01" },
      intervalSeconds: 300,
      dynamicTags: ["hall", "asset"],
      staticTags: tags,
      reductions: [{ aggregation: "sum", metricName: "ignored", field: "reading" }],
    });
    jobIds.push(differentMetric.job.id);

    const differentTags = await createJob(db, {
      name: `other-tags-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = ROOM-01" },
      intervalSeconds: 300,
      staticTags: { asset_id: `OTHER-${suffix}` },
      reductions: [{ aggregation: "count", metricName: metric }],
    });
    jobIds.push(differentTags.job.id);

    const dynamic = await createJob(db, {
      name: `dynamic-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = ROOM-01" },
      intervalSeconds: 300,
      dynamicTags: ["status"],
      staticTags: tags,
      reductions: [{ aggregation: "count", metricName: metric }],
    });
    jobIds.push(dynamic.job.id);

    const kept = await updateJob(db, job.id, {
      name: `original-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = ROOM-01" },
      intervalSeconds: 900,
      dynamicTags: ["asset", "hall"],
      staticTags: tags,
      reductions: [{ aggregation: "count", metricName: metric }],
    });
    expect(kept.job.intervalSeconds).toBe(900);

    await expect(
      updateJob(db, differentMetric.job.id, {
        name: `other-metric-${suffix}`,
        connectionId: connection.id,
        query: { text: "pk = ROOM-01" },
        intervalSeconds: 300,
        dynamicTags: ["hall", "asset"],
        staticTags: tags,
        reductions: [{ aggregation: "count", metricName: "ignored" }],
      }),
    ).rejects.toThrow(`A job already writes row_count with these tags: original-${suffix}.`);
  } finally {
    for (const jobId of jobIds) {
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
    if (otherConnectionId) {
      await db.delete(connections).where(eq(connections.id, otherConnectionId));
    }
  }
});

test("updates a monitor and keeps the webhook when none is supplied", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  const webhook = "http://slack.test/stored";
  let connectionId: string | undefined;
  const jobIds: string[] = [];
  let monitorId: string | undefined;

  try {
    const connection = await createConnection(db, {
      name: `monitor-edit-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const first = await createJob(db, {
      name: `monitor-job-a-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = A" },
      intervalSeconds: 300,
      enabled: false,
      staticTags: { asset_id: `A-${suffix}` },
      reductions: [{ aggregation: "count", metricName: "faulted_count" }],
    });
    const second = await createJob(db, {
      name: `monitor-job-b-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = B" },
      intervalSeconds: 300,
      enabled: false,
      staticTags: { asset_id: `B-${suffix}` },
      reductions: [{ aggregation: "count", metricName: "faulted_count" }],
    });
    jobIds.push(first.job.id, second.job.id);
    const monitor = await createMonitor(db, {
      name: `page-${suffix}`,
      jobIds: [first.job.id],
      metricName: "faulted_count",
      tagFilter: { asset_id: [`A-${suffix}`] },
      threshold: 1,
      severity: "critical",
      team: "hall",
      notifyMode: "slack",
      slackWebhook: webhook,
    });
    monitorId = monitor?.id;

    const kept = await updateMonitor(db, monitorId ?? "", {
      name: `page-edited-${suffix}`,
      jobIds: [first.job.id],
      metricName: "faulted_count",
      tagFilter: { asset_id: [`A-${suffix}`] },
      threshold: 2,
      severity: "warning",
      team: "hall",
      manualUrl: "https://example.test/manual",
    });
    const [stored] = await db.select().from(monitors).where(eq(monitors.id, kept?.id ?? ""));
    expect(stored?.name).toBe(`page-edited-${suffix}`);
    expect(stored?.threshold).toBe(2);
    expect(stored?.severity).toEqual({ mode: "fixed", fixed: "warning" });
    expect(stored?.manualUrl).toBe("https://example.test/manual");
    expect(stored?.slackWebhook).toBe(webhook);

    await updateMonitor(db, monitorId ?? "", {
      name: `page-edited-${suffix}`,
      jobIds: [first.job.id, second.job.id],
      metricName: "faulted_count",
      threshold: 2,
      severity: "warning",
      team: "hall",
      slackWebhook: "http://slack.test/next",
    });
    const links = await db.select().from(monitorJobs).where(eq(monitorJobs.monitorId, monitorId ?? ""));
    const [replaced] = await db.select().from(monitors).where(eq(monitors.id, monitorId ?? ""));
    expect(links.map((link) => link.jobId).sort()).toEqual([first.job.id, second.job.id].sort());
    expect(replaced?.slackWebhook).toBe("http://slack.test/next");
  } finally {
    if (monitorId) {
      await db.delete(monitors).where(eq(monitors.id, monitorId));
    }
    for (const jobId of jobIds) {
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

test("updates a connection and keeps the secret when none is supplied", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  const secret = JSON.stringify({ accessKeyId: "key", secretAccessKey: "secret" });
  let connectionId: string | undefined;

  try {
    const connection = await createConnection(db, {
      name: `edit-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret,
      config: { tableName: "snapshots", region: "us-east-1" },
    });
    connectionId = connection.id;

    const updated = await updateConnection(db, connection.id, {
      name: `edited-${suffix}`,
      sourceType: "dynamodb",
      config: { tableName: "other", region: "us-west-2" },
    });
    expect(updated.name).toBe(`edited-${suffix}`);
    expect(updated.config).toEqual({ tableName: "other", region: "us-west-2" });
    expect(updated.secret).toBe(secret);

    const replaced = await updateConnection(db, connection.id, {
      name: `edited-${suffix}`,
      sourceType: "dynamodb",
      config: { tableName: "other", region: "us-west-2", endpoint: "http://127.0.0.1:8000" },
      secret: JSON.stringify({ accessKeyId: "next", secretAccessKey: "next-secret" }),
    });
    expect(replaced.secret).toContain("next-secret");
    expect(replaced.config).toEqual({ tableName: "other", region: "us-west-2", endpoint: "http://127.0.0.1:8000" });
  } finally {
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

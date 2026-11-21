import { eq } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { connections, jobs, points, runs } from "@/db/schema";
import { createConnection, createJob } from "@/db/store";
import { runDueJobs } from "@/scheduler/run-due";
import { createDynamoConnector } from "./connector";
import type { SnapshotItem } from "./items";

afterAll(async () => {
  await closeDb();
});

test("a run stores the row count, and a later empty window stores zero", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;
  const supplied: SnapshotItem[] = [
    { pk: "ASSET-1", sk: "2026-11-13T15:00:00.000000000Z", status: "FAULTED" },
    { pk: "ASSET-1", sk: "2026-11-13T15:30:00.000000000Z", status: "RUNNING" },
    { pk: "ASSET-1", sk: "2026-11-13T15:40:00.000000000Z", status: "FAULTED" },
    { pk: "ASSET-1", sk: "2026-11-13T16:00:00.000000000Z", status: "FAULTED" },
    { pk: "OTHER", sk: "2026-11-13T15:40:00.000000000Z", status: "FAULTED" },
  ];
  const connector = createDynamoConnector(async () => supplied);

  try {
    const connection = await createConnection(db, {
      name: `dynamo-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: JSON.stringify({ accessKeyId: "local", secretAccessKey: "local" }),
      config: { tableName: "snapshots", region: "us-east-1" },
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `count-${suffix}`,
      connectionId: connection.id,
      query: { partitionKey: "ASSET-1" },
      intervalSeconds: 2,
      maxLookbackSeconds: 3600,
      staticTags: { asset_id: "ASSET-1" },
      reductions: [{ aggregation: "count", metricName: "ignored" }],
    });
    jobId = job.id;

    const first = new Date("2026-11-13T16:00:00.000Z");
    const connectors = new Map([["dynamodb", connector]]);
    await runDueJobs(db, first, connectors, job.id);
    await runDueJobs(db, new Date(first.getTime() + 2000), connectors, job.id);
    await runDueJobs(db, new Date(first.getTime() + 4000), connectors, job.id);

    const written = await db.select().from(points).where(eq(points.jobId, job.id));
    const recorded = await db.select().from(runs).where(eq(runs.jobId, job.id));
    const byTime = (metricName: string) =>
      written
        .filter((point) => point.metricName === metricName)
        .map((point) => ({ time: new Date(point.time).toISOString(), value: point.value, asset: point.tags.asset_id }))
        .sort((left, right) => left.time.localeCompare(right.time));

    expect(recorded.filter((run) => run.status === "success")).toHaveLength(3);
    expect(byTime("row_count")).toEqual([
      { time: "2026-11-13T16:00:00.000Z", value: 3, asset: "ASSET-1" },
      { time: "2026-11-13T16:00:02.000Z", value: 1, asset: "ASSET-1" },
      { time: "2026-11-13T16:00:04.000Z", value: 0, asset: "ASSET-1" },
    ]);
    const [stored] = await db.select({ health: jobs.health }).from(jobs).where(eq(jobs.id, job.id));
    expect(stored?.health).toBe("ok");
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

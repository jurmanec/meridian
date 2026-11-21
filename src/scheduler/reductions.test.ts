import { eq, inArray } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { connections, jobs, monitorJobs, monitors, monitorStates, notifications, points, runs } from "@/db/schema";
import { createConnection, createJob, createMonitor } from "@/db/store";
import type { SlackMessage } from "@/monitor/slack";
import { createDynamoConnector } from "@/sources/dynamodb/connector";
import type { SnapshotItem } from "@/sources/dynamodb/items";
import { runDueJobs } from "./run-due";

afterAll(async () => {
  await closeDb();
});

test("two metrics, a source tag, and consecutive points page only a single asset", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;
  const sent: SlackMessage[] = [];
  const supplied: SnapshotItem[] = [
    { pk: "HALL", sk: "2026-11-13T15:10:00.000000000Z", status: "FAULTED", fields: { asset_id: "CRAH-01", reading: 4 } },
    { pk: "HALL", sk: "2026-11-13T15:20:00.000000000Z", status: "FAULTED", fields: { reading: 9 } },
  ];
  const connector = createDynamoConnector(async () => supplied);

  try {
    const connection = await createConnection(db, {
      name: `m6-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: JSON.stringify({ accessKeyId: "local", secretAccessKey: "local" }),
      config: { tableName: "snapshots", region: "us-east-1" },
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `m6-job-${suffix}`,
      connectionId: connection.id,
      query: { partitionKey: "HALL" },
      intervalSeconds: 1,
      maxLookbackSeconds: 3600,
      staticTags: { run: suffix },
      dynamicTags: ["asset_id"],
      reductions: [
        { aggregation: "count", metricName: "ignored", filter: { status: "FAULTED" } },
        { aggregation: "sum", metricName: "ignored", field: "reading" },
      ],
    });
    jobId = job.id;
    const monitor = await createMonitor(db, {
      name: `m6-page-${suffix}`,
      jobId: job.id,
      metricName: "row_count",
      threshold: 1,
      consecutivePoints: 2,
      severity: "critical",
      team: "hall",
      slackWebhook: "http://slack.test/hook",
    });

    const send = async (message: SlackMessage) => {
      sent.push(message);
    };
    const first = new Date("2026-11-13T16:00:00.000Z");
    const connectors = new Map([["dynamodb", connector]]);
    await runDueJobs(db, first, connectors, job.id, send);

    supplied.push(
      { pk: "HALL", sk: "2026-11-13T16:00:00.100000000Z", status: "FAULTED", fields: { asset_id: "CRAH-01", reading: 1 } },
      { pk: "HALL", sk: "2026-11-13T16:00:00.200000000Z", status: "FAULTED", fields: { reading: 1 } },
    );
    await runDueJobs(db, new Date(first.getTime() + 1000), connectors, job.id, send);
    await runDueJobs(
      db,
      new Date(first.getTime() + 2000),
      new Map([["dynamodb", { async run() { throw new Error("read failed"); } }]]),
      job.id,
      send,
    );

    supplied.push(
      { pk: "HALL", sk: "2026-11-13T16:00:02.000000000Z", status: "RUNNING", fields: { asset_id: "CRAH-01", reading: 0 } },
      { pk: "HALL", sk: "2026-11-13T16:00:02.100000000Z", status: "RUNNING", fields: { reading: 0 } },
    );
    await runDueJobs(db, new Date(first.getTime() + 3000), connectors, job.id, send);

    const written = await db.select().from(points).where(eq(points.jobId, job.id));
    const recorded = await db.select().from(runs).where(eq(runs.jobId, job.id));
    const states = await db.select().from(monitorStates).where(eq(monitorStates.monitorId, monitor?.id ?? ""));
    const messages = await db.select().from(notifications).where(eq(notifications.monitorId, monitor?.id ?? ""));

    expect(recorded.filter((run) => run.status === "success")).toHaveLength(3);
    expect(recorded.filter((run) => run.status === "failed")).toHaveLength(1);
    expect(
      written
        .filter((point) => point.metricName === "reading_sum" && point.tags.asset_id === "CRAH-01")
        .sort((left, right) => left.time.getTime() - right.time.getTime())
        .map((point) => point.value),
    ).toEqual([4, 1, 0]);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.text).toContain("Monitor FIRING:");
    expect(sent[0]?.text).toContain("*Series:* asset_id=CRAH-01");
    expect(sent[1]?.text).toContain("Monitor RESOLVED:");
    expect(messages.map((row) => row.transition)).toEqual(["firing", "resolved"]);
    expect(states.find((state) => state.tags.asset_id === "CRAH-01")?.status).toBe("ok");
    expect(states.find((state) => !state.tags.asset_id)?.status).toBe("ok");
    expect(sent.every((message) => message.text.includes("asset_id=CRAH-01"))).toBe(true);
  } finally {
    if (jobId) {
      const links = await db.select({ monitorId: monitorJobs.monitorId }).from(monitorJobs).where(eq(monitorJobs.jobId, jobId));
      const ids = links.map((link) => link.monitorId);
      if (ids.length > 0) {
        await db.delete(monitors).where(inArray(monitors.id, ids));
      }
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

test("condition dynamic tags write zero for missing series so alerts resolve", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;
  const sent: SlackMessage[] = [];
  let supplied: SnapshotItem[] = [
    {
      pk: "HALL",
      sk: "2026-11-14T21:00:00.000000000Z",
      status: "FAULTED",
      fields: { asset_id: "ROOM-01" },
      document: {
        pk: "HALL",
        asset_id: "ROOM-01",
        alarms: [{ severity: "critical" }],
      },
    },
    {
      pk: "HALL",
      sk: "2026-11-14T21:00:01.000000000Z",
      status: "FAULTED",
      fields: { asset_id: "ROOM-01" },
      document: {
        pk: "HALL",
        asset_id: "ROOM-01",
        alarms: [{ severity: "warning" }],
      },
    },
  ];
  const connector = createDynamoConnector(async () => supplied);

  try {
    const connection = await createConnection(db, {
      name: `cond-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: JSON.stringify({ accessKeyId: "local", secretAccessKey: "local" }),
      config: { tableName: "snapshots", region: "us-east-1" },
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `cond-job-${suffix}`,
      connectionId: connection.id,
      query: { partitionKey: "HALL" },
      intervalSeconds: 1,
      maxLookbackSeconds: 3600,
      staticTags: { hall_id: "HALL-01" },
      dynamicTags: [
        { type: "field", name: "asset_id", absent: "omit" },
        {
          type: "path",
          tag: "alarm_severity",
          path: "alarms[*].severity",
          pick: "priority",
          priority: ["critical", "warning", "info"],
          whenEmpty: null,
          absent: "zero",
        },
      ],
      reductions: [{ aggregation: "count", metricName: "row_count" }],
    });
    jobId = job.id;
    await createMonitor(db, {
      name: `crit-${suffix}`,
      jobId: job.id,
      metricName: "row_count",
      tagFilter: { alarm_severity: "critical" },
      threshold: 1,
      severity: "critical",
      team: "hall",
      slackWebhook: "http://slack.test/crit",
    });
    await createMonitor(db, {
      name: `warn-${suffix}`,
      jobId: job.id,
      metricName: "row_count",
      tagFilter: { alarm_severity: "warning" },
      threshold: 1,
      severity: "warning",
      team: "hall",
      slackWebhook: "http://slack.test/warn",
    });

    const send = async (message: SlackMessage) => {
      sent.push(message);
    };
    const connectors = new Map([["dynamodb", connector]]);
    const first = new Date("2026-11-14T22:00:00.000Z");
    await runDueJobs(db, first, connectors, job.id, send);
    expect(sent).toHaveLength(2);
    expect(sent.every((message) => message.text.includes("FIRING"))).toBe(true);

    supplied = [];
    await runDueJobs(db, new Date(first.getTime() + 1000), connectors, job.id, send);

    const written = await db
      .select()
      .from(points)
      .where(eq(points.jobId, job.id));
    const latest = written.filter((point) => point.time.getTime() === first.getTime() + 1000);
    expect(
      latest
        .filter((point) => point.tags.alarm_severity)
        .map((point) => ({ severity: point.tags.alarm_severity, value: point.value }))
        .sort((left, right) => left.severity.localeCompare(right.severity)),
    ).toEqual([
      { severity: "critical", value: 0 },
      { severity: "warning", value: 0 },
    ]);
    expect(sent).toHaveLength(4);
    expect(sent.filter((message) => message.text.includes("RESOLVED"))).toHaveLength(2);
  } finally {
    if (jobId) {
      const links = await db.select({ monitorId: monitorJobs.monitorId }).from(monitorJobs).where(eq(monitorJobs.jobId, jobId));
      const ids = links.map((link) => link.monitorId);
      if (ids.length > 0) {
        await db.delete(monitors).where(inArray(monitors.id, ids));
      }
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

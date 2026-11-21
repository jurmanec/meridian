import { and, eq, inArray } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { connections, jobs, monitorJobs, monitors, monitorStates, notifications, points } from "@/db/schema";
import { createConnection, createJob, createMonitor, writePoint } from "@/db/store";
import { runDueJobs } from "@/scheduler/run-due";
import type { C3AlertEvent } from "./c3";
import { evaluateMonitors } from "./evaluate";
import { slackText } from "./message";
import type { SlackMessage } from "./slack";

test("blank manual URL is left out of the Slack message", () => {
  const text = slackText({
    monitorName: "page",
    transition: "firing",
    value: 2,
    tags: { asset_id: "A-1" },
    metricName: "row_count",
    threshold: 1,
    consecutivePoints: 1,
    windowStart: new Date("2026-11-14T15:00:00.000Z"),
    windowEnd: new Date("2026-11-14T15:05:00.000Z"),
    manualUrl: "",
  });
  expect(text).toContain(":rotating_light: Monitor FIRING: *page*");
  expect(text).toContain("*State:* OK → ALERT");
  expect(text).toContain("*Series:* asset_id=A-1");
  expect(text).toContain(
    "*Detail:* value 2 matched GTE threshold 1 for 1 consecutive point for metric row_count",
  );
  expect(text).toContain("*Window:* 2026-11-14T15:00:00.000Z – 2026-11-14T15:05:00.000Z");
  expect(text).not.toContain("*URL:*");
});

test("firing icon follows resolved severity", () => {
  expect(
    slackText({
      monitorName: "page",
      transition: "firing",
      value: 2,
      tags: { asset_id: "A-1" },
      metricName: "row_count",
      threshold: 1,
      consecutivePoints: 1,
      windowStart: new Date("2026-11-14T15:00:00.000Z"),
      windowEnd: new Date("2026-11-14T15:05:00.000Z"),
      manualUrl: "",
      severity: "critical",
    }),
  ).toContain("🚨 *CRITICAL* Monitor FIRING: *page*");
  expect(
    slackText({
      monitorName: "page",
      transition: "firing",
      value: 2,
      tags: { asset_id: "A-1" },
      metricName: "row_count",
      threshold: 1,
      consecutivePoints: 1,
      windowStart: new Date("2026-11-14T15:00:00.000Z"),
      windowEnd: new Date("2026-11-14T15:05:00.000Z"),
      manualUrl: "",
      severity: "warning",
    }),
  ).toContain("⚠️ *WARNING* Monitor FIRING: *page*");
  expect(
    slackText({
      monitorName: "page",
      transition: "firing",
      value: 2,
      tags: { asset_id: "A-1" },
      metricName: "row_count",
      threshold: 1,
      consecutivePoints: 1,
      windowStart: new Date("2026-11-14T15:00:00.000Z"),
      windowEnd: new Date("2026-11-14T15:05:00.000Z"),
      manualUrl: "",
      severity: "info",
    }),
  ).toContain("ℹ️ *INFO* Monitor FIRING: *page*");
});

afterAll(async () => {
  await closeDb();
});

test("a crossing sends one firing message, a later zero sends one recovery, and a failed run sends neither", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;
  const sent: SlackMessage[] = [];
  const values = [0, 2, 2, 0];
  let call = 0;
  const writing = new Map([
    [
      "dynamodb",
      {
        async run() {
          const value = values[call] ?? 0;
          call += 1;
          return [{ metricName: "faulted_count", value, tags: {} }];
        },
      },
    ],
  ]);
  const failing = new Map([
    [
      "dynamodb",
      {
        async run() {
          throw new Error("read failed");
        },
      },
    ],
  ]);

  try {
    const connection = await createConnection(db, {
      name: `monitor-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `watched-${suffix}`,
      connectionId: connection.id,
      query: { partitionKey: "ASSET-2" },
      intervalSeconds: 1,
      staticTags: { asset_id: `ASSET-${suffix}` },
      reductions: [{ aggregation: "count", metricName: "faulted_count" }],
    });
    jobId = job.id;
    const page = await createMonitor(db, {
      name: `page-${suffix}`,
      jobId: job.id,
      metricName: "faulted_count",
      tagFilter: { asset_id: `ASSET-${suffix}` },
      threshold: 1,
      severity: "critical",
      team: "hall",
      manualUrl: "https://example.test/manual",
      slackWebhook: "http://slack.test/hook",
    });
    await createMonitor(db, {
      name: `other-${suffix}`,
      jobId: job.id,
      metricName: "faulted_count",
      tagFilter: { asset_id: "OTHER" },
      threshold: 1,
      severity: "critical",
      team: "hall",
      manualUrl: "https://example.test/manual",
      slackWebhook: "http://slack.test/other",
    });

    const send = async (message: SlackMessage) => {
      sent.push(message);
    };
    const first = new Date("2026-11-13T18:00:00.000Z");
    for (let tick = 0; tick < values.length; tick += 1) {
      await runDueJobs(db, new Date(first.getTime() + tick * 1000), writing, job.id, send);
    }
    await runDueJobs(db, new Date(first.getTime() + values.length * 1000), failing, job.id, send);

    expect(sent.map((message) => message.webhookUrl)).toEqual(["http://slack.test/hook", "http://slack.test/hook"]);
    expect(sent[0]?.text).toContain(`🚨 *CRITICAL* Monitor FIRING: *page-${suffix}*`);
    expect(sent[0]?.text).toContain("*State:* OK → ALERT");
    expect(sent[0]?.text).toContain(`*Series:* asset_id=ASSET-${suffix}`);
    expect(sent[0]?.text).toContain(
      "*Detail:* value 2 matched GTE threshold 1 for 1 consecutive point for metric faulted_count",
    );
    expect(sent[0]?.text).toContain("*Window:*");
    expect(sent[0]?.text).toContain("*URL:* https://example.test/manual");
    expect(sent[1]?.text).toContain(`:white_check_mark: Monitor RESOLVED: *page-${suffix}*`);
    expect(sent[1]?.text).toContain("*State:* ALERT → OK");
    expect(sent[1]?.text).toContain(
      "*Detail:* value 0 no longer matched GTE threshold 1 for 1 consecutive point for metric faulted_count",
    );
    const stored = await db.select().from(notifications).where(eq(notifications.monitorId, page?.id ?? ""));
    expect(stored.map((row) => row.transition)).toEqual(["firing", "resolved"]);
  } finally {
    if (jobId) {
      await deleteJobMonitors(db, jobId);
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

test("paged transitions emit matching C3 FIRING and RESOLVED with the same alert_key", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;
  const sent: SlackMessage[] = [];
  const alerts: C3AlertEvent[] = [];
  const values = [0, 2, 0];
  let call = 0;

  try {
    const connection = await createConnection(db, {
      name: `c3-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `c3-job-${suffix}`,
      connectionId: connection.id,
      query: { partitionKey: "ASSET-2" },
      intervalSeconds: 1,
      staticTags: { asset_id: `ASSET-${suffix}`, hall_id: "HALL-01" },
      reductions: [{ aggregation: "count", metricName: "faulted_count" }],
    });
    jobId = job.id;
    await createMonitor(db, {
      name: `c3-page-${suffix}`,
      jobId: job.id,
      metricName: "faulted_count",
      tagFilter: { asset_id: `ASSET-${suffix}` },
      threshold: 1,
      severity: "warning",
      team: "facility-ops",
      manualUrl: "https://example.test/manual",
      notifyMode: "webhook",
      alertWebhook: "http://p8.test",
    });

    const writing = new Map([
      [
        "dynamodb",
        {
          async run() {
            const value = values[call] ?? 0;
            call += 1;
            return [{ metricName: "faulted_count", value, tags: {} }];
          },
        },
      ],
    ]);
    const first = new Date("2026-11-14T18:00:00.000Z");
    for (let tick = 0; tick < values.length; tick += 1) {
      await runDueJobs(db, new Date(first.getTime() + tick * 1000), writing, job.id, {
        send: async (message) => {
          sent.push(message);
        },
        deliverAlert: async (event) => {
          alerts.push(event);
        },
      });
    }

    expect(sent).toHaveLength(0);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]?.transition).toBe("FIRING");
    expect(alerts[1]?.transition).toBe("RESOLVED");
    expect(alerts[0]?.alert_key).toBe(alerts[1]?.alert_key);
    expect(alerts[0]?.fired_at).toBe(alerts[1]?.fired_at);
    expect(alerts[0]?.severity).toBe("warning");
    expect(alerts[0]?.team).toBe("facility-ops");
    expect(alerts[0]?.labels).toEqual({
      asset_id: `ASSET-${suffix}`,
      hall_id: "HALL-01",
    });
    expect(alerts[0]?.details.monitor_id).toBeTruthy();
    expect(alerts[0]?.details.job_id).toBe(job.id);
    expect(alerts[1]?.details.value).toBe(0);
    expect(alerts[0]?.contract).toBe("p8.alert");
    expect(alerts[0]?.version).toBe("0.3");
  } finally {
    if (jobId) {
      await deleteJobMonitors(db, jobId);
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

test("warning then critical folds into one identity incident (shared alert_key)", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;
  const alerts: C3AlertEvent[] = [];
  const identity = { asset_id: `ROOM-${suffix}`, hall_id: "HALL-01" };
  const warningTags = { ...identity, alarm_severity: "warning" };
  const criticalTags = { ...identity, alarm_severity: "critical" };

  try {
    const connection = await createConnection(db, {
      name: `sev-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `sev-job-${suffix}`,
      connectionId: connection.id,
      query: { partitionKey: "ROOM" },
      intervalSeconds: 60,
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
      name: `sev-mon-${suffix}`,
      jobId: job.id,
      metricName: "row_count",
      tagFilter: { asset_id: `ROOM-${suffix}` },
      threshold: 1,
      severity: {
        mode: "from_tag",
        tag: "alarm_severity",
        map: { warning: "warning", critical: "critical", info: "info" },
        whenMissing: "omit",
      },
      team: "facility-ops",
      manualUrl: "https://example.test/manual",
      notifyMode: "webhook",
      alertWebhook: "http://p8.test",
    });

    const deliver = {
      deliverAlert: async (event: C3AlertEvent) => {
        alerts.push(event);
      },
      p8AlertUrl: "http://p8.test",
    };

    const t0 = new Date("2026-11-18T20:00:00.000Z");
    await writePoint(db, {
      time: t0,
      jobId: job.id,
      metricName: "row_count",
      tags: warningTags,
      value: 1,
    });
    const open = await evaluateMonitors(
      db,
      job.id,
      [{ metricName: "row_count", value: 1, tags: warningTags, time: t0 }],
      deliver,
    );
    expect(open).toHaveLength(1);
    expect(open[0]?.transition).toBe("firing");
    expect(open[0]?.severityUpdate).toBeFalsy();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.transition).toBe("FIRING");
    expect(alerts[0]?.severity).toBe("warning");

    const t1 = new Date("2026-11-18T20:05:00.000Z");
    await writePoint(db, {
      time: t1,
      jobId: job.id,
      metricName: "row_count",
      tags: criticalTags,
      value: 1,
    });
    await writePoint(db, {
      time: t1,
      jobId: job.id,
      metricName: "row_count",
      tags: warningTags,
      value: 0,
    });
    const updated = await evaluateMonitors(
      db,
      job.id,
      [
        { metricName: "row_count", value: 1, tags: criticalTags, time: t1 },
        { metricName: "row_count", value: 0, tags: warningTags, time: t1 },
      ],
      deliver,
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]?.transition).toBe("firing");
    expect(updated[0]?.severityUpdate).toBe(true);
    expect(alerts).toHaveLength(2);
    expect(alerts[1]?.transition).toBe("FIRING");
    expect(alerts[1]?.severity).toBe("critical");
    expect(alerts[1]?.alert_key).toBe(alerts[0]?.alert_key);
    expect(alerts[1]?.fired_at).toBe(alerts[0]?.fired_at);
    expect(alerts[1]?.event_id).not.toBe(alerts[0]?.event_id);

    const t2 = new Date("2026-11-18T20:10:00.000Z");
    await writePoint(db, {
      time: t2,
      jobId: job.id,
      metricName: "row_count",
      tags: criticalTags,
      value: 0,
    });
    const closed = await evaluateMonitors(
      db,
      job.id,
      [{ metricName: "row_count", value: 0, tags: criticalTags, time: t2 }],
      deliver,
    );
    expect(closed).toHaveLength(1);
    expect(closed[0]?.transition).toBe("resolved");
    expect(alerts).toHaveLength(3);
    expect(alerts[2]?.transition).toBe("RESOLVED");
    expect(alerts[2]?.alert_key).toBe(alerts[0]?.alert_key);
    expect(alerts[2]?.fired_at).toBe(alerts[0]?.fired_at);
  } finally {
    if (jobId) {
      await deleteJobMonitors(db, jobId);
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

test("a series with no asset id is not paged", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;
  const sent: SlackMessage[] = [];

  try {
    const connection = await createConnection(db, {
      name: `unpaged-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `unpaged-job-${suffix}`,
      connectionId: connection.id,
      query: { partitionKey: "ASSET-2" },
      intervalSeconds: 1,
      staticTags: { run: suffix },
      reductions: [{ aggregation: "count", metricName: "faulted_count" }],
    });
    jobId = job.id;
    const monitor = await createMonitor(db, {
      name: `unpaged-monitor-${suffix}`,
      jobId: job.id,
      metricName: "faulted_count",
      threshold: 1,
      severity: "critical",
      team: "hall",
      slackWebhook: "http://slack.test/hook",
    });
    await runDueJobs(
      db,
      new Date("2026-11-13T19:00:00.000Z"),
      new Map([["dynamodb", { async run() { return [{ metricName: "faulted_count", value: 2, tags: {} }]; } }]]),
      job.id,
      async (message) => {
        sent.push(message);
      },
    );

    const [state] = await db.select().from(monitorStates).where(eq(monitorStates.monitorId, monitor?.id ?? ""));
    expect(sent).toHaveLength(0);
    expect(state?.status).toBe("alert");
  } finally {
    if (jobId) {
      await deleteJobMonitors(db, jobId);
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

test("one monitor evaluates each selected job on its own", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  const jobIds: string[] = [];
  const sent: SlackMessage[] = [];

  try {
    const connection = await createConnection(db, {
      name: `multi-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const first = await createJob(db, {
      name: `room-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = ROOM" },
      intervalSeconds: 1,
      staticTags: { asset_id: `ROOM-${suffix}`, hall_id: "HALL-01" },
      reductions: [{ aggregation: "count", metricName: "faulted_count" }],
    });
    const second = await createJob(db, {
      name: `crah-${suffix}`,
      connectionId: connection.id,
      query: { text: "pk = CRAH" },
      intervalSeconds: 1,
      staticTags: { asset_id: `CRAH-${suffix}`, hall_id: "HALL-01" },
      reductions: [{ aggregation: "count", metricName: "faulted_count" }],
    });
    jobIds.push(first.job.id, second.job.id);
    await createMonitor(db, {
      name: `hall-${suffix}`,
      jobIds: [first.job.id, second.job.id],
      metricName: "faulted_count",
      tagFilter: { asset_id: [`ROOM-${suffix}`, `CRAH-${suffix}`] },
      threshold: 1,
      severity: "critical",
      team: "hall",
      slackWebhook: "http://slack.test/hook",
    });

    const send = async (message: SlackMessage) => {
      sent.push(message);
    };
    const now = new Date("2026-11-13T20:00:00.000Z");
    const writing = (value: number) =>
      new Map([["dynamodb", { async run() { return [{ metricName: "faulted_count", value, tags: {} }]; } }]]);
    await runDueJobs(db, now, writing(2), first.job.id, send);
    await runDueJobs(db, now, writing(0), second.job.id, send);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain(`Monitor FIRING: *hall-${suffix}*`);
    expect(sent[0]?.text).toContain(`*Series:* asset_id=ROOM-${suffix}, hall_id=HALL-01`);
  } finally {
    for (const jobId of jobIds) {
      await deleteJobMonitors(db, jobId);
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

test("an unmatched firing resolves once the member series is already ok", async () => {
  const db = getDb();
  const suffix = crypto.randomUUID();
  let connectionId: string | undefined;
  let jobId: string | undefined;
  const tags = {
    alarm_code: "UPS_ON_BATTERY",
    alarm_severity: "warning",
    asset_id: `ROOM-${suffix}`,
    hall_id: "HALL-01",
    status: "FAULTED",
  };
  const sent: SlackMessage[] = [];

  try {
    const connection = await createConnection(db, {
      name: `stuck-${suffix}`,
      sourceType: "dynamodb",
      secretRef: "inline",
      secret: "test-secret",
    });
    connectionId = connection.id;
    const { job } = await createJob(db, {
      name: `stuck-job-${suffix}`,
      connectionId: connection.id,
      query: { partitionKey: "HALL" },
      intervalSeconds: 60,
      staticTags: { hall_id: "HALL-01", status: "FAULTED" },
      dynamicTags: [
        { type: "field", name: "asset_id", absent: "omit" },
        { type: "field", name: "alarm_code", absent: "zero" },
        { type: "field", name: "alarm_severity", absent: "zero" },
      ],
      reductions: [{ aggregation: "count", metricName: "row_count" }],
    });
    jobId = job.id;
    const monitor = await createMonitor(db, {
      name: `stuck-mon-${suffix}`,
      jobId: job.id,
      metricName: "row_count",
      tagFilter: { asset_id: `ROOM-${suffix}` },
      threshold: 1,
      severity: "warning",
      team: "facility-ops",
      manualUrl: "https://example.test/manual",
      slackWebhook: "http://slack.test/hook",
    });
    const openedAt = new Date("2026-11-19T18:32:10.557Z");
    await writePoint(db, { time: openedAt, jobId: job.id, metricName: "row_count", tags, value: 1 });
    const opened = await evaluateMonitors(
      db,
      job.id,
      [{ metricName: "row_count", value: 1, tags, time: openedAt }],
      async (message) => {
        sent.push(message);
      },
    );
    expect(opened.map((row) => row.transition)).toEqual(["firing"]);

    const states = await db.select().from(monitorStates).where(eq(monitorStates.monitorId, monitor.id));
    for (const row of states) {
      if (row.seriesKey.includes('"incident"')) {
        await db
          .delete(monitorStates)
          .where(and(eq(monitorStates.monitorId, monitor.id), eq(monitorStates.seriesKey, row.seriesKey)));
        continue;
      }
      await db
        .update(monitorStates)
        .set({ status: "ok", value: 0, alertOpenedAt: null, pageSeverity: null })
        .where(and(eq(monitorStates.monitorId, monitor.id), eq(monitorStates.seriesKey, row.seriesKey)));
    }

    const clearedAt = new Date("2026-11-19T19:12:27.041Z");
    await writePoint(db, { time: clearedAt, jobId: job.id, metricName: "row_count", tags, value: 0 });
    const cleared = await evaluateMonitors(
      db,
      job.id,
      [{ metricName: "row_count", value: 0, tags, time: clearedAt }],
      async (message) => {
        sent.push(message);
      },
    );
    expect(cleared.map((row) => row.transition)).toEqual(["resolved"]);
    expect(sent[1]?.text).toContain("Monitor RESOLVED");

    const again = await evaluateMonitors(
      db,
      job.id,
      [{ metricName: "row_count", value: 0, tags, time: new Date("2026-11-19T19:20:00.000Z") }],
      async (message) => {
        sent.push(message);
      },
    );
    expect(again).toHaveLength(0);
    expect(sent).toHaveLength(2);
  } finally {
    if (jobId) {
      await deleteJobMonitors(db, jobId);
      await db.delete(points).where(eq(points.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    if (connectionId) {
      await db.delete(connections).where(eq(connections.id, connectionId));
    }
  }
});

async function deleteJobMonitors(db: ReturnType<typeof getDb>, jobId: string) {
  const links = await db.select({ monitorId: monitorJobs.monitorId }).from(monitorJobs).where(eq(monitorJobs.jobId, jobId));
  const ids = links.map((link) => link.monitorId);
  if (ids.length > 0) {
    await db.delete(monitors).where(inArray(monitors.id, ids));
  }
}

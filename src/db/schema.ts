import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { DynamicTag } from "./dynamic-tags";
import type { SeverityConfig } from "./severity";

export const windowModes = ["since_last_run", "fixed_lookback", "calendar"] as const;
export type WindowMode = (typeof windowModes)[number];

export const runStatuses = ["running", "success", "failed"] as const;
export type RunStatus = (typeof runStatuses)[number];

export const jobHealth = ["ok", "failing"] as const;
export type JobHealth = (typeof jobHealth)[number];

export const seriesStatuses = ["ok", "alert"] as const;
export type SeriesStatus = (typeof seriesStatuses)[number];

export const notificationTransitions = ["firing", "resolved"] as const;
export type NotificationTransition = (typeof notificationTransitions)[number];

export type Tags = Record<string, string>;

export type TagFilter = Record<string, string[]>;

export type { DynamicTag, FieldDynamicTag, PathDynamicTag } from "./dynamic-tags";
export type { SeverityConfig, SeverityLevel, SeverityMode } from "./severity";

export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  sourceType: text("source_type").notNull(),
  secretRef: text("secret_ref").notNull(),
  secret: text("secret").notNull().default(""),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id),
    enabled: boolean("enabled").notNull().default(true),
    health: text("health").$type<JobHealth>().notNull().default("ok"),
    query: jsonb("query").$type<Record<string, unknown>>().notNull(),
    windowMode: text("window_mode").$type<WindowMode>().notNull().default("since_last_run"),
    maxLookbackSeconds: integer("max_lookback_seconds").notNull().default(86_400),
    intervalSeconds: integer("interval_seconds").notNull(),
    staticTags: jsonb("static_tags").$type<Tags>().notNull().default({}),
    dynamicTags: jsonb("dynamic_tags").$type<DynamicTag[]>().notNull().default([]),
    cron: text("cron").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "jobs_window_mode",
      sql`${table.windowMode} in ('since_last_run', 'fixed_lookback', 'calendar')`,
    ),
    check("jobs_max_lookback_positive", sql`${table.maxLookbackSeconds} > 0`),
    check("jobs_interval_positive", sql`${table.intervalSeconds} > 0`),
    check("jobs_health", sql`${table.health} in ('ok', 'failing')`),
  ],
);

export const reductions = pgTable(
  "reductions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    aggregation: text("aggregation").notNull(),
    metricName: text("metric_name").notNull(),
    field: text("field"),
    filter: jsonb("filter").$type<Record<string, unknown>>(),
  },
  (table) => [
    unique("reductions_job_metric").on(table.jobId, table.metricName),
    unique("reductions_job_position").on(table.jobId, table.position),
    check("reductions_position_non_negative", sql`${table.position} >= 0`),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    status: text("status").$type<RunStatus>().notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("runs_status", sql`${table.status} in ('running', 'success', 'failed')`),
    check("runs_window_order", sql`${table.windowEnd} > ${table.windowStart}`),
  ],
);

export const points = pgTable(
  "points",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    jobId: uuid("job_id").notNull(),
    metricName: text("metric_name").notNull(),
    tags: jsonb("tags").$type<Tags>().notNull(),
    value: doublePrecision("value").notNull(),
    runId: uuid("run_id"),
  },
  (table) => [
    primaryKey({ columns: [table.time, table.jobId, table.metricName, table.tags] }),
  ],
);

export const notifyModes = ["slack", "webhook"] as const;
export type NotifyMode = (typeof notifyModes)[number];

export const monitors = pgTable(
  "monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    metricName: text("metric_name").notNull(),
    tagFilter: jsonb("tag_filter").$type<TagFilter>().notNull().default({}),
    threshold: doublePrecision("threshold").notNull(),
    severity: jsonb("severity").$type<SeverityConfig>().notNull().default({ mode: "unset" }),
    team: text("team").notNull(),
    manualUrl: text("manual_url").notNull().default(""),
    notifyMode: text("notify_mode").$type<NotifyMode>().notNull().default("slack"),
    slackWebhook: text("slack_webhook").notNull().default(""),
    alertWebhook: text("alert_webhook").notNull().default(""),
    consecutivePoints: integer("consecutive_points").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("monitors_consecutive_positive", sql`${table.consecutivePoints} > 0`),
    check("monitors_notify_mode", sql`${table.notifyMode} in ('slack', 'webhook')`),
  ],
);

export const monitorJobs = pgTable(
  "monitor_jobs",
  {
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.monitorId, table.jobId] })],
);

export const monitorStates = pgTable(
  "monitor_states",
  {
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    seriesKey: text("series_key").notNull(),
    tags: jsonb("tags").$type<Tags>().notNull(),
    status: text("status").$type<SeriesStatus>().notNull(),
    value: doublePrecision("value").notNull(),
    /** When the series/incident last entered ALERT; used as C3 `fired_at` through resolve. */
    alertOpenedAt: timestamp("alert_opened_at", { withTimezone: true }),
    /** Last notified page severity for identity incident rows (`critical`/`warning`/`info`). */
    pageSeverity: text("page_severity"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.monitorId, table.seriesKey] }),
    check("monitor_states_status", sql`${table.status} in ('ok', 'alert')`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    tags: jsonb("tags").$type<Tags>().notNull(),
    transition: text("transition").$type<NotificationTransition>().notNull(),
    value: doublePrecision("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("notifications_transition", sql`${table.transition} in ('firing', 'resolved')`)],
);

CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"secret_ref" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"query" jsonb NOT NULL,
	"window_mode" text DEFAULT 'since_last_run' NOT NULL,
	"max_lookback_seconds" integer DEFAULT 86400 NOT NULL,
	"interval_seconds" integer NOT NULL,
	"static_tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_window_mode" CHECK ("jobs"."window_mode" in ('since_last_run', 'fixed_lookback', 'calendar')),
	CONSTRAINT "jobs_max_lookback_positive" CHECK ("jobs"."max_lookback_seconds" > 0),
	CONSTRAINT "jobs_interval_positive" CHECK ("jobs"."interval_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "points" (
	"time" timestamp with time zone NOT NULL,
	"job_id" uuid NOT NULL,
	"metric_name" text NOT NULL,
	"tags" jsonb NOT NULL,
	"value" double precision NOT NULL,
	"run_id" uuid,
	CONSTRAINT "points_time_job_id_metric_name_tags_pk" PRIMARY KEY("time","job_id","metric_name","tags")
);
--> statement-breakpoint
CREATE TABLE "reductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"aggregation" text NOT NULL,
	"metric_name" text NOT NULL,
	"field" text,
	"filter" jsonb,
	CONSTRAINT "reductions_job_metric" UNIQUE("job_id","metric_name"),
	CONSTRAINT "reductions_job_position" UNIQUE("job_id","position"),
	CONSTRAINT "reductions_position_non_negative" CHECK ("reductions"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_status" CHECK ("runs"."status" in ('running', 'success', 'failed')),
	CONSTRAINT "runs_window_order" CHECK ("runs"."window_end" > "runs"."window_start")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reductions" ADD CONSTRAINT "reductions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint
SELECT create_hypertable('points', 'time', if_not_exists => TRUE);
CREATE TABLE "monitor_states" (
	"monitor_id" uuid NOT NULL,
	"series_key" text NOT NULL,
	"tags" jsonb NOT NULL,
	"status" text NOT NULL,
	"value" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitor_states_monitor_id_series_key_pk" PRIMARY KEY("monitor_id","series_key"),
	CONSTRAINT "monitor_states_status" CHECK ("monitor_states"."status" in ('ok', 'alert'))
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"job_id" uuid NOT NULL,
	"metric_name" text NOT NULL,
	"tag_filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"threshold" double precision NOT NULL,
	"severity" text NOT NULL,
	"team" text NOT NULL,
	"manual_url" text DEFAULT '' NOT NULL,
	"slack_webhook" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"tags" jsonb NOT NULL,
	"transition" text NOT NULL,
	"value" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_transition" CHECK ("notifications"."transition" in ('firing', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "monitor_states" ADD CONSTRAINT "monitor_states_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;
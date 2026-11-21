CREATE TABLE "monitor_jobs" (
	"monitor_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	CONSTRAINT "monitor_jobs_monitor_id_job_id_pk" PRIMARY KEY("monitor_id","job_id")
);
--> statement-breakpoint
ALTER TABLE "monitor_jobs" ADD CONSTRAINT "monitor_jobs_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "monitor_jobs" ADD CONSTRAINT "monitor_jobs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "monitor_jobs" ("monitor_id", "job_id") SELECT "id", "job_id" FROM "monitors";
--> statement-breakpoint
ALTER TABLE "monitors" DROP CONSTRAINT "monitors_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "monitors" DROP COLUMN "job_id";
--> statement-breakpoint
UPDATE "monitors" AS monitor
SET "tag_filter" = COALESCE((
	SELECT jsonb_object_agg(
		entry.key,
		CASE WHEN jsonb_typeof(entry.value) = 'array' THEN entry.value ELSE jsonb_build_array(entry.value) END
	)
	FROM jsonb_each(monitor.tag_filter) AS entry
), '{}'::jsonb);

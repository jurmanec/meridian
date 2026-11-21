ALTER TABLE "jobs" ADD COLUMN "health" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_health" CHECK ("jobs"."health" in ('ok', 'failing'));
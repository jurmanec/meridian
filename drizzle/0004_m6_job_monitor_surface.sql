ALTER TABLE "jobs" ADD COLUMN "dynamic_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "cron" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "consecutive_points" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_consecutive_positive" CHECK ("monitors"."consecutive_points" > 0);
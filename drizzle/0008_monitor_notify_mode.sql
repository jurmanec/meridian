ALTER TABLE "monitors" ADD COLUMN "notify_mode" text DEFAULT 'slack' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "alert_webhook" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ALTER COLUMN "slack_webhook" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_notify_mode" CHECK ("notify_mode" in ('slack', 'webhook'));

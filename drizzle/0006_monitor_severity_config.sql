ALTER TABLE "monitors" ADD COLUMN "severity_config" jsonb;--> statement-breakpoint
UPDATE "monitors"
SET "severity_config" = CASE
	WHEN "severity" IS NULL OR btrim("severity") = '' THEN '{"mode":"unset"}'::jsonb
	WHEN lower(btrim("severity")) IN ('critical', 'warning', 'info') THEN jsonb_build_object('mode', 'fixed', 'fixed', lower(btrim("severity")))
	ELSE '{"mode":"unset"}'::jsonb
END;--> statement-breakpoint
ALTER TABLE "monitors" ALTER COLUMN "severity_config" SET DEFAULT '{"mode":"unset"}'::jsonb;--> statement-breakpoint
ALTER TABLE "monitors" ALTER COLUMN "severity_config" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" DROP COLUMN "severity";--> statement-breakpoint
ALTER TABLE "monitors" RENAME COLUMN "severity_config" TO "severity";

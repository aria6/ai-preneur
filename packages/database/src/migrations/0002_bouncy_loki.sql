ALTER TABLE "sm_publications" ADD COLUMN "warning_message" varchar(500);--> statement-breakpoint
ALTER TABLE "sm_publications" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sm_publications" ADD COLUMN "container_id" varchar(128);--> statement-breakpoint
ALTER TABLE "sm_publications" ADD COLUMN "publish_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "sm_publications_status_idx" ON "sm_publications" USING btree ("status");
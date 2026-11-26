ALTER TYPE "public"."sm_publication_status" ADD VALUE 'queued';--> statement-breakpoint
ALTER TABLE "sm_publications" ADD COLUMN "progress_stage" varchar(20);--> statement-breakpoint
ALTER TABLE "sm_publications" ADD COLUMN "progress_percent" integer;
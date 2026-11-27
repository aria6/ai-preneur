CREATE TYPE "public"."bi_agency" AS ENUM('social_media', 'business_development', 'software_house', 'iot', 'digital_marketing', 'education', 'digital_content', 'food_estate', 'other');--> statement-breakpoint
CREATE TYPE "public"."bi_label" AS ENUM('execute', 'validate', 'park');--> statement-breakpoint
CREATE TYPE "public"."bi_market_scope" AS ENUM('indonesia', 'global');--> statement-breakpoint
CREATE TYPE "public"."bi_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bi_stage" AS ENUM('new', 'researched', 'executed');--> statement-breakpoint
CREATE TABLE "bank_idea_research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "bi_run_status" DEFAULT 'queued' NOT NULL,
	"market_scope" "bi_market_scope" NOT NULL,
	"rubric_version" varchar(20) NOT NULL,
	"total_score" integer,
	"label" "bi_label",
	"result" jsonb,
	"error_message" varchar(1000),
	"attempts" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"meta" jsonb,
	"requested_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bank_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_input" text DEFAULT '' NOT NULL,
	"title" varchar(200) NOT NULL,
	"summary" varchar(2000) NOT NULL,
	"problem" varchar(2000) DEFAULT '' NOT NULL,
	"target_market" varchar(2000) DEFAULT '' NOT NULL,
	"solution" varchar(2000) DEFAULT '' NOT NULL,
	"agency" "bi_agency" NOT NULL,
	"market_scope" "bi_market_scope" DEFAULT 'indonesia' NOT NULL,
	"stage" "bi_stage" DEFAULT 'new' NOT NULL,
	"latest_score" integer,
	"latest_label" "bi_label",
	"last_researched_at" timestamp with time zone,
	"content_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_idea_research_runs" ADD CONSTRAINT "bank_idea_research_runs_idea_id_bank_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."bank_ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_idea_runs_idea_version_unique" ON "bank_idea_research_runs" USING btree ("idea_id","version");--> statement-breakpoint
CREATE INDEX "bank_idea_runs_idea_created_idx" ON "bank_idea_research_runs" USING btree ("idea_id","created_at");--> statement-breakpoint
CREATE INDEX "bank_idea_runs_status_created_idx" ON "bank_idea_research_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_idea_runs_one_active_per_idea" ON "bank_idea_research_runs" USING btree ("idea_id") WHERE "bank_idea_research_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "bank_idea_runs_one_running" ON "bank_idea_research_runs" USING btree ("status") WHERE "bank_idea_research_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "bank_ideas_archived_created_idx" ON "bank_ideas" USING btree ("archived_at","created_at");
ALTER TABLE "bank_ideas" ADD COLUMN "synthesis_status" varchar(20) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_ideas" ADD COLUMN "synthesis" jsonb;--> statement-breakpoint
ALTER TABLE "bank_ideas" ADD COLUMN "synthesis_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_ideas" ADD COLUMN "synthesis_run_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_ideas" ADD COLUMN "synthesis_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_ideas" ADD COLUMN "synthesis_error" varchar(1000);
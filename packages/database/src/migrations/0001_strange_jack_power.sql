CREATE TYPE "public"."sm_account_status" AS ENUM('connected', 'error');--> statement-breakpoint
CREATE TYPE "public"."sm_batch_status" AS ENUM('draft', 'scheduled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."sm_platform" AS ENUM('instagram', 'tiktok', 'facebook', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."sm_publication_status" AS ENUM('processing', 'published', 'failed');--> statement-breakpoint
CREATE TABLE "sm_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"platform" "sm_platform" NOT NULL,
	"external_account_id" varchar(128) NOT NULL,
	"username" varchar(150),
	"account_type" varchar(50),
	"encrypted_credentials" text NOT NULL,
	"status" "sm_account_status" DEFAULT 'connected' NOT NULL,
	"last_error" varchar(500),
	"token_expires_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sm_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"idea_number" integer NOT NULL,
	"drive_folder_id" varchar(200) NOT NULL,
	"drive_folder_url" varchar(500) NOT NULL,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "sm_batch_status" DEFAULT 'draft' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sm_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"platform" "sm_platform" NOT NULL,
	"status" "sm_publication_status" NOT NULL,
	"external_media_id" varchar(128),
	"external_url" varchar(500),
	"error_message" varchar(1000),
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sm_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"topic_number" integer NOT NULL,
	"part_number" integer,
	"title" varchar(200) NOT NULL,
	"video_file_id" varchar(200) NOT NULL,
	"video_file_name" varchar(300) NOT NULL,
	"thumbnail_file_id" varchar(200),
	"thumbnail_file_name" varchar(300),
	"caption" text DEFAULT '' NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"scheduled_at" timestamp with time zone,
	"is_paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sm_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"lock_minutes" integer DEFAULT 30 NOT NULL,
	"min_confirm_lead_minutes" integer DEFAULT 60 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sm_settings_singleton" CHECK ("sm_settings"."id" = 1),
	CONSTRAINT "sm_settings_lead_gte_lock" CHECK ("sm_settings"."min_confirm_lead_minutes" >= "sm_settings"."lock_minutes")
);
--> statement-breakpoint
ALTER TABLE "sm_accounts" ADD CONSTRAINT "sm_accounts_batch_id_sm_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sm_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sm_publications" ADD CONSTRAINT "sm_publications_item_id_sm_queue_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."sm_queue_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sm_queue_items" ADD CONSTRAINT "sm_queue_items_batch_id_sm_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sm_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sm_accounts_batch_platform_unique" ON "sm_accounts" USING btree ("batch_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "sm_accounts_platform_external_unique" ON "sm_accounts" USING btree ("platform","external_account_id");--> statement-breakpoint
CREATE INDEX "sm_batches_status_idx" ON "sm_batches" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sm_publications_item_platform_unique" ON "sm_publications" USING btree ("item_id","platform");--> statement-breakpoint
CREATE INDEX "sm_queue_items_batch_position_idx" ON "sm_queue_items" USING btree ("batch_id","position");--> statement-breakpoint
CREATE INDEX "sm_queue_items_scheduled_at_idx" ON "sm_queue_items" USING btree ("scheduled_at");
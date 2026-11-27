CREATE TYPE "public"."sm_collection_run_kind" AS ENUM('initial', 'update');--> statement-breakpoint
CREATE TYPE "public"."sm_collection_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "sm_collected_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_media_id" varchar(128) NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"permalink" varchar(500),
	"thumbnail_url" text,
	"media_type" varchar(30),
	"product_type" varchar(30),
	"posted_at" timestamp with time zone,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"comments_synced_count" integer,
	"comments_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sm_collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" "sm_collection_run_kind" NOT NULL,
	"status" "sm_collection_run_status" DEFAULT 'running' NOT NULL,
	"progress_stage" varchar(20),
	"progress_detail" varchar(200),
	"new_posts" integer DEFAULT 0 NOT NULL,
	"new_comments" integer DEFAULT 0 NOT NULL,
	"new_conversations" integer DEFAULT 0 NOT NULL,
	"new_messages" integer DEFAULT 0 NOT NULL,
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"error_message" varchar(1000),
	"started_by_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sm_collection_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"platform" "sm_platform" NOT NULL,
	"external_account_id" varchar(128) NOT NULL,
	"username" varchar(150),
	"window_start" timestamp with time zone,
	"initial_completed_at" timestamp with time zone,
	"dm_watermark" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sm_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"external_comment_id" varchar(128) NOT NULL,
	"parent_external_id" varchar(128),
	"author_external_id" varchar(128),
	"username" varchar(150),
	"is_from_account" boolean DEFAULT false NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"like_count" integer,
	"commented_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sm_dm_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_conversation_id" varchar(200) NOT NULL,
	"participant_external_id" varchar(128),
	"participant_username" varchar(150),
	"last_message_at" timestamp with time zone,
	"possibly_incomplete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sm_dm_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"external_message_id" varchar(300) NOT NULL,
	"sender_external_id" varchar(128),
	"sender_username" varchar(150),
	"is_from_account" boolean DEFAULT false NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"attachment_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sm_collected_posts" ADD CONSTRAINT "sm_collected_posts_source_id_sm_collection_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sm_collection_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sm_collection_runs" ADD CONSTRAINT "sm_collection_runs_source_id_sm_collection_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sm_collection_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sm_collection_sources" ADD CONSTRAINT "sm_collection_sources_batch_id_sm_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sm_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sm_comments" ADD CONSTRAINT "sm_comments_source_id_sm_collection_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sm_collection_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sm_comments" ADD CONSTRAINT "sm_comments_post_id_sm_collected_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."sm_collected_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sm_dm_conversations" ADD CONSTRAINT "sm_dm_conversations_source_id_sm_collection_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sm_collection_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sm_dm_messages" ADD CONSTRAINT "sm_dm_messages_source_id_sm_collection_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sm_collection_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sm_dm_messages" ADD CONSTRAINT "sm_dm_messages_conversation_id_sm_dm_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."sm_dm_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sm_collected_posts_media_unique" ON "sm_collected_posts" USING btree ("source_id","external_media_id");--> statement-breakpoint
CREATE INDEX "sm_collected_posts_posted_idx" ON "sm_collected_posts" USING btree ("source_id","posted_at");--> statement-breakpoint
CREATE INDEX "sm_collection_runs_source_started_idx" ON "sm_collection_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sm_collection_runs_one_running" ON "sm_collection_runs" USING btree ("source_id") WHERE "sm_collection_runs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "sm_collection_sources_account_unique" ON "sm_collection_sources" USING btree ("batch_id","platform","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sm_comments_external_unique" ON "sm_comments" USING btree ("source_id","external_comment_id");--> statement-breakpoint
CREATE INDEX "sm_comments_source_time_idx" ON "sm_comments" USING btree ("source_id","commented_at");--> statement-breakpoint
CREATE INDEX "sm_comments_post_idx" ON "sm_comments" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sm_dm_conversations_external_unique" ON "sm_dm_conversations" USING btree ("source_id","external_conversation_id");--> statement-breakpoint
CREATE INDEX "sm_dm_conversations_last_idx" ON "sm_dm_conversations" USING btree ("source_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sm_dm_messages_external_unique" ON "sm_dm_messages" USING btree ("source_id","external_message_id");--> statement-breakpoint
CREATE INDEX "sm_dm_messages_conversation_time_idx" ON "sm_dm_messages" USING btree ("conversation_id","sent_at");
/**
 * Social Media AIgency tables.
 * Owner: apps/api/src/modules/social-media — no other module may query these tables directly.
 *
 * Self-contained (no imports from other schema files) so Drizzle Kit can load it
 * standalone. `created_by_id` therefore has no FK to users; it is informational.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
// $onUpdate must return a Date (drizzle-orm 0.44 wraps it in a timestamp param).
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const smPlatform = pgEnum('sm_platform', ['instagram', 'tiktok', 'facebook', 'youtube']);
export const smBatchStatus = pgEnum('sm_batch_status', ['draft', 'scheduled', 'completed']);
export const smAccountStatus = pgEnum('sm_account_status', ['connected', 'error']);
export const smPublicationStatus = pgEnum('sm_publication_status', [
  'processing',
  'published',
  'failed',
  /** Manual upload ("Unggah sekarang") waiting for the worker. */
  'queued',
]);

// ---- Settings (single row) ---------------------------------------------------------

export const smSettings = pgTable(
  'sm_settings',
  {
    id: integer().primaryKey().default(1),
    /** Rows closer than this to their schedule can no longer be edited. */
    lockMinutes: integer().notNull().default(30),
    /** Confirming a batch requires its first video to be at least this far away. */
    minConfirmLeadMinutes: integer().notNull().default(60),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('sm_settings_singleton', sql`${t.id} = 1`),
    check('sm_settings_lead_gte_lock', sql`${t.minConfirmLeadMinutes} >= ${t.lockMinutes}`),
  ],
);

// ---- Batches (one per idea) --------------------------------------------------------

export const smBatches = pgTable(
  'sm_batches',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** The idea's title, free text. */
    title: varchar({ length: 200 }).notNull(),
    /** The idea's description, free text (optional). */
    description: varchar({ length: 2000 }),
    /** IDEA_ID: taken from file names or generated. Unique across batches. */
    ideaNumber: integer().notNull(),
    driveFolderId: varchar({ length: 200 }).notNull(),
    driveFolderUrl: varchar({ length: 500 }).notNull(),
    /** Selected target platforms (values of sm_platform). */
    platforms: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: smBatchStatus().notNull().default('draft'),
    confirmedAt: timestamp({ withTimezone: true }),
    /** Set while the idea is archived: read-only, nothing uploads. Only Draft/Selesai. */
    archivedAt: timestamp({ withTimezone: true }),
    createdById: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sm_batches_status_idx').on(t.status),
    // One IDEA_ID per idea: file names `<IDEA_ID>.<TOPIC_ID>-…` must point at one batch.
    uniqueIndex('sm_batches_idea_number_unique').on(t.ideaNumber),
  ],
);

// ---- Accounts (one per idea per platform; one account never serves two ideas) ------

export const smAccounts = pgTable(
  'sm_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    batchId: uuid()
      .notNull()
      .references(() => smBatches.id, { onDelete: 'cascade' }),
    platform: smPlatform().notNull(),
    /** The platform's own account ID (e.g. Instagram professional account ID). */
    externalAccountId: varchar({ length: 128 }).notNull(),
    username: varchar({ length: 150 }),
    accountType: varchar({ length: 50 }),
    /** AES-256-GCM encrypted JSON (tokens). Never returned by the API. */
    encryptedCredentials: text().notNull(),
    status: smAccountStatus().notNull().default('connected'),
    lastError: varchar({ length: 500 }),
    tokenExpiresAt: timestamp({ withTimezone: true }),
    lastCheckedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sm_accounts_batch_platform_unique').on(t.batchId, t.platform),
    // Enforces "one social account belongs to exactly one idea".
    uniqueIndex('sm_accounts_platform_external_unique').on(t.platform, t.externalAccountId),
  ],
);

// ---- Queue items -------------------------------------------------------------------

export const smQueueItems = pgTable(
  'sm_queue_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    batchId: uuid()
      .notNull()
      .references(() => smBatches.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    /** TOPIC_ID */
    topicNumber: integer().notNull(),
    partNumber: integer(),
    title: varchar({ length: 200 }).notNull(),
    videoFileId: varchar({ length: 200 }).notNull(),
    videoFileName: varchar({ length: 300 }).notNull(),
    thumbnailFileId: varchar({ length: 200 }),
    thumbnailFileName: varchar({ length: 300 }),
    caption: text().notNull().default(''),
    hashtags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    scheduledAt: timestamp({ withTimezone: true }),
    /** "Ditunda": skipped by the publisher until resumed. */
    isPaused: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sm_queue_items_batch_position_idx').on(t.batchId, t.position),
    index('sm_queue_items_scheduled_at_idx').on(t.scheduledAt),
  ],
);

// ---- Publications (one per item per platform attempt) ------------------------------

export const smPublications = pgTable(
  'sm_publications',
  {
    id: uuid().primaryKey().defaultRandom(),
    itemId: uuid()
      .notNull()
      .references(() => smQueueItems.id, { onDelete: 'cascade' }),
    platform: smPlatform().notNull(),
    status: smPublicationStatus().notNull(),
    externalMediaId: varchar({ length: 128 }),
    externalUrl: varchar({ length: 500 }),
    errorMessage: varchar({ length: 1000 }),
    /** Published with a caveat the user should know (e.g. no cover, no link). */
    warningMessage: varchar({ length: 500 }),
    attempts: integer().notNull().default(0),
    startedAt: timestamp({ withTimezone: true }),
    publishedAt: timestamp({ withTimezone: true }),
    /** Current step of a queued/processing upload (shown as progress). */
    progressStage: varchar({ length: 20 }),
    /** 0–100 for steps that report it (download), else null. */
    progressPercent: integer(),
    /** Failed rows only: when the worker tries again. Null = no automatic retry. */
    nextAttemptAt: timestamp({ withTimezone: true }),
    /** The platform's upload container of the current attempt (crash recovery). */
    containerId: varchar({ length: 128 }),
    /**
     * Set right before the final "publish" call of the current attempt. A crashed
     * attempt without it is safe to repeat; with it the post may already be live.
     */
    publishRequestedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // The unique pair is also the publisher's claim: inserting the row atomically
  // reserves the upload, so two workers can never publish the same item twice.
  (t) => [
    uniqueIndex('sm_publications_item_platform_unique').on(t.itemId, t.platform),
    index('sm_publications_status_idx').on(t.status),
  ],
);

// ---- Analysis Engine: Data Collection AIgent ---------------------------------------
//
// Comments and DMs of each idea's accounts, collected incrementally ("Ambil data" /
// "Perbarui data"). Keyed by the platform account (not by the sm_accounts row), so
// reconnecting the same account — e.g. to add a permission — keeps everything collected.

export const smCollectionRunKind = pgEnum('sm_collection_run_kind', ['initial', 'update']);
export const smCollectionRunStatus = pgEnum('sm_collection_run_status', [
  'running',
  'succeeded',
  'failed',
]);

/** One collected account of one idea, with the watermarks of the incremental fetch. */
export const smCollectionSources = pgTable(
  'sm_collection_sources',
  {
    id: uuid().primaryKey().defaultRandom(),
    batchId: uuid()
      .notNull()
      .references(() => smBatches.id, { onDelete: 'cascade' }),
    platform: smPlatform().notNull(),
    externalAccountId: varchar({ length: 128 }).notNull(),
    username: varchar({ length: 150 }),
    /** Oldest post time collected (set by the first fetch: 90 days back). */
    windowStart: timestamp({ withTimezone: true }),
    /** Set once the first fetch ("Ambil data") finished; afterwards "Perbarui data". */
    initialCompletedAt: timestamp({ withTimezone: true }),
    /** Newest conversation `updated_time` fully read. Null = DMs never read yet. */
    dmWatermark: timestamp({ withTimezone: true }),
    lastSucceededAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sm_collection_sources_account_unique').on(
      t.batchId,
      t.platform,
      t.externalAccountId,
    ),
  ],
);

/** One press of "Ambil data" / "Perbarui data": progress, result and errors. */
export const smCollectionRuns = pgTable(
  'sm_collection_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => smCollectionSources.id, { onDelete: 'cascade' }),
    kind: smCollectionRunKind().notNull(),
    status: smCollectionRunStatus().notNull().default('running'),
    /** Current step while running (posts, comments, dms). */
    progressStage: varchar({ length: 20 }),
    progressDetail: varchar({ length: 200 }),
    newPosts: integer().notNull().default(0),
    newComments: integer().notNull().default(0),
    newConversations: integer().notNull().default(0),
    newMessages: integer().notNull().default(0),
    /** Things the user should know although the run succeeded (e.g. DMs not readable). */
    warnings: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    errorMessage: varchar({ length: 1000 }),
    startedById: uuid(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Updated while running; a stale heartbeat means the server stopped mid-run. */
    heartbeatAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('sm_collection_runs_source_started_idx').on(t.sourceId, t.startedAt),
    // The lock: one running collection per account.
    uniqueIndex('sm_collection_runs_one_running')
      .on(t.sourceId)
      .where(sql`${t.status} = 'running'`),
  ],
);

/** Posts whose comments are collected (all posts of the account inside the window). */
export const smCollectedPosts = pgTable(
  'sm_collected_posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => smCollectionSources.id, { onDelete: 'cascade' }),
    externalMediaId: varchar({ length: 128 }).notNull(),
    caption: text().notNull().default(''),
    permalink: varchar({ length: 500 }),
    thumbnailUrl: text(),
    mediaType: varchar({ length: 30 }),
    productType: varchar({ length: 30 }),
    postedAt: timestamp({ withTimezone: true }),
    /** comments_count the platform reported on the last fetch. */
    commentsCount: integer().notNull().default(0),
    /** comments_count when its comments were last read completely: equal = nothing new. */
    commentsSyncedCount: integer(),
    commentsSyncedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sm_collected_posts_media_unique').on(t.sourceId, t.externalMediaId),
    index('sm_collected_posts_posted_idx').on(t.sourceId, t.postedAt),
  ],
);

export const smComments = pgTable(
  'sm_comments',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => smCollectionSources.id, { onDelete: 'cascade' }),
    postId: uuid()
      .notNull()
      .references(() => smCollectedPosts.id, { onDelete: 'cascade' }),
    externalCommentId: varchar({ length: 128 }).notNull(),
    /** Set on replies: the top-level comment replied to. */
    parentExternalId: varchar({ length: 128 }),
    authorExternalId: varchar({ length: 128 }),
    username: varchar({ length: 150 }),
    /** Written by the idea's own account (e.g. its replies). */
    isFromAccount: boolean().notNull().default(false),
    text: text().notNull().default(''),
    likeCount: integer(),
    commentedAt: timestamp({ withTimezone: true }).notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sm_comments_external_unique').on(t.sourceId, t.externalCommentId),
    index('sm_comments_source_time_idx').on(t.sourceId, t.commentedAt),
    index('sm_comments_post_idx').on(t.postId),
  ],
);

export const smDmConversations = pgTable(
  'sm_dm_conversations',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => smCollectionSources.id, { onDelete: 'cascade' }),
    externalConversationId: varchar({ length: 200 }).notNull(),
    participantExternalId: varchar({ length: 128 }),
    participantUsername: varchar({ length: 150 }),
    /** Conversation `updated_time`: time of its latest message. */
    lastMessageAt: timestamp({ withTimezone: true }),
    /**
     * Older messages could not be read: the platform only returns the 20 latest
     * messages of a conversation.
     */
    possiblyIncomplete: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sm_dm_conversations_external_unique').on(t.sourceId, t.externalConversationId),
    index('sm_dm_conversations_last_idx').on(t.sourceId, t.lastMessageAt),
  ],
);

export const smDmMessages = pgTable(
  'sm_dm_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => smCollectionSources.id, { onDelete: 'cascade' }),
    conversationId: uuid()
      .notNull()
      .references(() => smDmConversations.id, { onDelete: 'cascade' }),
    externalMessageId: varchar({ length: 300 }).notNull(),
    senderExternalId: varchar({ length: 128 }),
    senderUsername: varchar({ length: 150 }),
    /** Sent by the idea's own account (outgoing). */
    isFromAccount: boolean().notNull().default(false),
    text: text().notNull().default(''),
    /** Kinds of attachments (image, video, audio, file, share, story, …). */
    attachmentTypes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    sentAt: timestamp({ withTimezone: true }).notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sm_dm_messages_external_unique').on(t.sourceId, t.externalMessageId),
    index('sm_dm_messages_conversation_time_idx').on(t.conversationId, t.sentAt),
  ],
);

export type SmBatchRow = typeof smBatches.$inferSelect;
export type SmQueueItemRow = typeof smQueueItems.$inferSelect;
export type SmAccountRow = typeof smAccounts.$inferSelect;
export type SmPublicationRow = typeof smPublications.$inferSelect;
export type SmCollectionSourceRow = typeof smCollectionSources.$inferSelect;
export type SmCollectionRunRow = typeof smCollectionRuns.$inferSelect;
export type SmCollectedPostRow = typeof smCollectedPosts.$inferSelect;
export type SmCommentRow = typeof smComments.$inferSelect;
export type SmDmConversationRow = typeof smDmConversations.$inferSelect;
export type SmDmMessageRow = typeof smDmMessages.$inferSelect;

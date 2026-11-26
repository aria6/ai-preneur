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
    /** The idea, free text. */
    title: varchar({ length: 200 }).notNull(),
    /** IDEA_ID: taken from file names or generated. */
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
    createdById: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sm_batches_status_idx').on(t.status)],
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

export type SmBatchRow = typeof smBatches.$inferSelect;
export type SmQueueItemRow = typeof smQueueItems.$inferSelect;
export type SmAccountRow = typeof smAccounts.$inferSelect;
export type SmPublicationRow = typeof smPublications.$inferSelect;

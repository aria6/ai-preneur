/**
 * Bank Idea tables.
 * Owner: apps/api/src/modules/bank-idea — no other module may query these tables directly.
 *
 * Self-contained (no imports from other schema files) so Drizzle Kit can load it
 * standalone. `created_by_id` / `requested_by_id` therefore have no FK to users.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
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

export const biMarketScope = pgEnum('bi_market_scope', ['indonesia', 'global']);
export const biStage = pgEnum('bi_stage', ['new', 'researched', 'executed']);
export const biLabel = pgEnum('bi_label', ['execute', 'validate', 'park']);
export const biRunStatus = pgEnum('bi_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

// ---- Ideas -------------------------------------------------------------------------

export const bankIdeas = pgTable(
  'bank_ideas',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** The raw text the idea came from (kept for reference). */
    rawInput: text().notNull().default(''),
    title: varchar({ length: 200 }).notNull(),
    summary: varchar({ length: 2000 }).notNull(),
    problem: varchar({ length: 2000 }).notNull().default(''),
    targetMarket: varchar({ length: 2000 }).notNull().default(''),
    solution: varchar({ length: 2000 }).notNull().default(''),
    marketScope: biMarketScope().notNull().default('indonesia'),
    stage: biStage().notNull().default('new'),
    /** Copied from the latest successful research, for the list (sorting, filtering). */
    latestScore: integer(),
    latestLabel: biLabel(),
    lastResearchedAt: timestamp({ withTimezone: true }),
    /** Last change of the researched fields (not stage/archive) — "berubah sejak riset". */
    contentUpdatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Archived ideas are read-only (no edit, no research) until unarchived. */
    archivedAt: timestamp({ withTimezone: true }),
    createdById: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('bank_ideas_archived_created_idx').on(t.archivedAt, t.createdAt)],
);

// ---- Research runs (one row per research version) ----------------------------------

export const bankIdeaResearchRuns = pgTable(
  'bank_idea_research_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    ideaId: uuid()
      .notNull()
      .references(() => bankIdeas.id, { onDelete: 'cascade' }),
    /** 1, 2, 3 … per idea. */
    version: integer().notNull(),
    status: biRunStatus().notNull().default('queued'),
    /** Market scope used for this research (the idea's at queue time). */
    marketScope: biMarketScope().notNull(),
    rubricVersion: varchar({ length: 20 }).notNull(),
    totalScore: integer(),
    label: biLabel(),
    /** BankIdeaResearchResult (shared contract), set when succeeded. */
    result: jsonb(),
    errorMessage: varchar({ length: 1000 }),
    /** Claims so far (a run interrupted by a restart is re-queued up to a limit). */
    attempts: integer().notNull().default(0),
    durationMs: integer(),
    /** Provider details: cost, turns, model. Informational. */
    meta: jsonb(),
    requestedById: uuid(),
    createdAt: createdAt(),
    startedAt: timestamp({ withTimezone: true }),
    /** Updated while running; a stale heartbeat means the server stopped mid-run. */
    heartbeatAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('bank_idea_runs_idea_version_unique').on(t.ideaId, t.version),
    index('bank_idea_runs_idea_created_idx').on(t.ideaId, t.createdAt),
    index('bank_idea_runs_status_created_idx').on(t.status, t.createdAt),
    // One queued/running research per idea.
    uniqueIndex('bank_idea_runs_one_active_per_idea')
      .on(t.ideaId)
      .where(sql`${t.status} in ('queued', 'running')`),
    // One research running at a time across the whole platform (shared AI quota).
    uniqueIndex('bank_idea_runs_one_running')
      .on(t.status)
      .where(sql`${t.status} = 'running'`),
  ],
);

export type BankIdeaRow = typeof bankIdeas.$inferSelect;
export type BankIdeaResearchRunRow = typeof bankIdeaResearchRuns.$inferSelect;

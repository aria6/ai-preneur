import {
  and,
  asc,
  bankIdeaResearchRuns,
  bankIdeas,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  type BankIdeaResearchRunRow,
  type BankIdeaRow,
  type DatabaseExecutor,
} from '@ai-preneur/database';
import type { BankIdeaResearchResult } from '@ai-preneur/shared';

type IdeaInsert = typeof bankIdeas.$inferInsert;
type IdeaUpdate = Partial<Omit<IdeaInsert, 'id' | 'createdAt'>>;

const ACTIVE_STATUSES = ['queued', 'running'] as const;

/** A queued/running run with its 1-based place in the global queue (running = 1). */
export interface ActiveRun {
  id: string;
  ideaId: string;
  status: 'queued' | 'running';
  queuePosition: number;
  createdAt: Date;
  startedAt: Date | null;
}

export function createBankIdeaRepository(db: DatabaseExecutor) {
  return {
    // ---- Ideas ----

    async listIdeas(filter: 'active' | 'archived'): Promise<BankIdeaRow[]> {
      return db
        .select()
        .from(bankIdeas)
        .where(
          filter === 'archived' ? isNotNull(bankIdeas.archivedAt) : isNull(bankIdeas.archivedAt),
        )
        .orderBy(desc(bankIdeas.createdAt), desc(bankIdeas.id));
    },

    async findIdea(id: string): Promise<BankIdeaRow | undefined> {
      const [row] = await db.select().from(bankIdeas).where(eq(bankIdeas.id, id)).limit(1);
      return row;
    },

    /** Locks the idea row for the rest of the transaction. */
    async findIdeaForUpdate(id: string): Promise<BankIdeaRow | undefined> {
      const [row] = await db
        .select()
        .from(bankIdeas)
        .where(eq(bankIdeas.id, id))
        .limit(1)
        .for('update');
      return row;
    },

    async insertIdea(values: IdeaInsert): Promise<BankIdeaRow> {
      const [row] = await db.insert(bankIdeas).values(values).returning();
      return row!;
    },

    async updateIdea(id: string, values: IdeaUpdate): Promise<BankIdeaRow | undefined> {
      const [row] = await db.update(bankIdeas).set(values).where(eq(bankIdeas.id, id)).returning();
      return row;
    },

    /** Copies a successful research onto the idea; a "Baru" idea becomes "Diriset". */
    async recordResearch(
      id: string,
      values: { score: number; label: BankIdeaResearchResult['label']; at: Date },
    ): Promise<void> {
      await db
        .update(bankIdeas)
        .set({
          latestScore: values.score,
          latestLabel: values.label,
          lastResearchedAt: values.at,
          stage: sql`case when ${bankIdeas.stage} = 'new' then 'researched'::bi_stage else ${bankIdeas.stage} end`,
        })
        .where(eq(bankIdeas.id, id));
    },

    async deleteIdea(id: string): Promise<void> {
      await db.delete(bankIdeas).where(eq(bankIdeas.id, id));
    },

    // ---- Runs ----

    async listRuns(ideaId: string): Promise<BankIdeaResearchRunRow[]> {
      return db
        .select()
        .from(bankIdeaResearchRuns)
        .where(eq(bankIdeaResearchRuns.ideaId, ideaId))
        .orderBy(desc(bankIdeaResearchRuns.version));
    },

    async findRun(id: string): Promise<BankIdeaResearchRunRow | undefined> {
      const [row] = await db
        .select()
        .from(bankIdeaResearchRuns)
        .where(eq(bankIdeaResearchRuns.id, id))
        .limit(1);
      return row;
    },

    /** Every queued/running run, in queue order (the running one first). */
    async activeRuns(): Promise<ActiveRun[]> {
      const rows = await db
        .select({
          id: bankIdeaResearchRuns.id,
          ideaId: bankIdeaResearchRuns.ideaId,
          status: bankIdeaResearchRuns.status,
          createdAt: bankIdeaResearchRuns.createdAt,
          startedAt: bankIdeaResearchRuns.startedAt,
        })
        .from(bankIdeaResearchRuns)
        .where(inArray(bankIdeaResearchRuns.status, [...ACTIVE_STATUSES]))
        .orderBy(
          sql`case when ${bankIdeaResearchRuns.status} = 'running' then 0 else 1 end`,
          asc(bankIdeaResearchRuns.createdAt),
          asc(bankIdeaResearchRuns.id),
        );
      return rows.map((row, index) => ({
        ...row,
        status: row.status as ActiveRun['status'],
        queuePosition: index + 1,
      }));
    },

    async lastFinishedRunId(ideaId: string): Promise<string | null> {
      const [row] = await db
        .select({ id: bankIdeaResearchRuns.id })
        .from(bankIdeaResearchRuns)
        .where(
          and(eq(bankIdeaResearchRuns.ideaId, ideaId), isNotNull(bankIdeaResearchRuns.finishedAt)),
        )
        .orderBy(desc(bankIdeaResearchRuns.finishedAt))
        .limit(1);
      return row?.id ?? null;
    },

    async nextVersion(ideaId: string): Promise<number> {
      const [row] = await db
        .select({ max: sql<number | null>`max(${bankIdeaResearchRuns.version})` })
        .from(bankIdeaResearchRuns)
        .where(eq(bankIdeaResearchRuns.ideaId, ideaId));
      return Number(row?.max ?? 0) + 1;
    },

    async insertRun(
      values: typeof bankIdeaResearchRuns.$inferInsert,
    ): Promise<BankIdeaResearchRunRow> {
      const [row] = await db.insert(bankIdeaResearchRuns).values(values).returning();
      return row!;
    },

    /** Queued → cancelled. False when it is no longer queued. */
    async cancelQueued(id: string): Promise<boolean> {
      const rows = await db
        .update(bankIdeaResearchRuns)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(and(eq(bankIdeaResearchRuns.id, id), eq(bankIdeaResearchRuns.status, 'queued')))
        .returning({ id: bankIdeaResearchRuns.id });
      return rows.length > 0;
    },

    // ---- Worker ----

    /**
     * Claims the oldest queued run (queued → running). Null when nothing is queued or a
     * run is already running — the partial unique index `bank_idea_runs_one_running`
     * guarantees one running research platform-wide even with concurrent claims.
     */
    async claimNext(): Promise<BankIdeaResearchRunRow | null> {
      const [running] = await db
        .select({ id: bankIdeaResearchRuns.id })
        .from(bankIdeaResearchRuns)
        .where(eq(bankIdeaResearchRuns.status, 'running'))
        .limit(1);
      if (running) return null;

      const now = new Date();
      const rows = await db
        .update(bankIdeaResearchRuns)
        .set({
          status: 'running',
          startedAt: now,
          heartbeatAt: now,
          attempts: sql`${bankIdeaResearchRuns.attempts} + 1`,
        })
        .where(
          eq(
            bankIdeaResearchRuns.id,
            sql`(select id from ${bankIdeaResearchRuns} where ${bankIdeaResearchRuns.status} = 'queued' order by ${bankIdeaResearchRuns.createdAt}, ${bankIdeaResearchRuns.id} limit 1 for update skip locked)`,
          ),
        )
        .returning();
      return rows[0] ?? null;
    },

    async heartbeat(id: string): Promise<void> {
      await db
        .update(bankIdeaResearchRuns)
        .set({ heartbeatAt: new Date() })
        .where(and(eq(bankIdeaResearchRuns.id, id), eq(bankIdeaResearchRuns.status, 'running')));
    },

    /** Running → succeeded; false when the run is gone or no longer running (deleted idea). */
    async markSucceeded(
      id: string,
      values: { result: BankIdeaResearchResult; meta: Record<string, unknown>; durationMs: number },
    ): Promise<BankIdeaResearchRunRow | null> {
      const [row] = await db
        .update(bankIdeaResearchRuns)
        .set({
          status: 'succeeded',
          result: values.result,
          totalScore: values.result.totalScore,
          label: values.result.label,
          meta: values.meta,
          durationMs: values.durationMs,
          errorMessage: null,
          finishedAt: new Date(),
        })
        .where(and(eq(bankIdeaResearchRuns.id, id), eq(bankIdeaResearchRuns.status, 'running')))
        .returning();
      return row ?? null;
    },

    async markFinished(
      id: string,
      status: 'failed' | 'cancelled',
      values: { errorMessage: string | null; durationMs: number | null },
    ): Promise<void> {
      await db
        .update(bankIdeaResearchRuns)
        .set({
          status,
          errorMessage: values.errorMessage?.slice(0, 1000) ?? null,
          durationMs: values.durationMs,
          finishedAt: new Date(),
        })
        .where(and(eq(bankIdeaResearchRuns.id, id), eq(bankIdeaResearchRuns.status, 'running')));
    },

    /** Running → queued again (server stopping): the interrupted attempt does not count. */
    async requeue(id: string): Promise<void> {
      await db
        .update(bankIdeaResearchRuns)
        .set({
          status: 'queued',
          startedAt: null,
          heartbeatAt: null,
          attempts: sql`greatest(${bankIdeaResearchRuns.attempts} - 1, 0)`,
        })
        .where(and(eq(bankIdeaResearchRuns.id, id), eq(bankIdeaResearchRuns.status, 'running')));
    },

    /**
     * Runs left "running" by a server that died: re-queued, or failed after
     * `maxAttempts` claims (so a run that crashes the process cannot loop forever).
     */
    async recoverStale(staleBefore: Date, maxAttempts: number): Promise<number> {
      const stale = await db
        .select()
        .from(bankIdeaResearchRuns)
        .where(
          and(
            eq(bankIdeaResearchRuns.status, 'running'),
            lt(bankIdeaResearchRuns.heartbeatAt, staleBefore),
          ),
        );
      for (const run of stale) {
        await db
          .update(bankIdeaResearchRuns)
          .set(
            run.attempts >= maxAttempts
              ? {
                  status: 'failed',
                  errorMessage: 'Riset terhenti karena server berhenti di tengah proses.',
                  finishedAt: new Date(),
                }
              : { status: 'queued', startedAt: null, heartbeatAt: null },
          )
          .where(
            and(eq(bankIdeaResearchRuns.id, run.id), eq(bankIdeaResearchRuns.status, 'running')),
          );
      }
      return stale.length;
    },
  };
}

export type BankIdeaRepository = ReturnType<typeof createBankIdeaRepository>;

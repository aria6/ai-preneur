import {
  and,
  eq,
  inArray,
  isNotNull,
  lte,
  smBatches,
  smPublications,
  smQueueItems,
  sql,
  type DatabaseExecutor,
  type SmBatchRow,
  type SmPublicationRow,
  type SmQueueItemRow,
} from '@ai-preneur/database';

type Platform = SmPublicationRow['platform'];

/** Columns reset at the start of every attempt. */
const freshAttempt = {
  status: 'processing' as const,
  startedAt: sql`now()`,
  errorMessage: null,
  nextAttemptAt: null,
  containerId: null,
  publishRequestedAt: null,
};

export function createPublicationsRepository(db: DatabaseExecutor) {
  return {
    async listByItems(itemIds: string[]): Promise<SmPublicationRow[]> {
      if (itemIds.length === 0) return [];
      return db.select().from(smPublications).where(inArray(smPublications.itemId, itemIds));
    },

    /**
     * Atomically reserves the first upload of one item to one platform. Returns the new
     * publication ID, or null when it was already claimed (by this or another worker,
     * now or in the past) — the unique (item, platform) index makes this race-free.
     */
    async claim(itemId: string, platform: Platform): Promise<string | null> {
      const [row] = await db
        .insert(smPublications)
        .values({ itemId, platform, ...freshAttempt, attempts: 1 })
        .onConflictDoNothing({ target: [smPublications.itemId, smPublications.platform] })
        .returning({ id: smPublications.id });
      return row?.id ?? null;
    },

    /**
     * Failed uploads whose retry time has come, on active rows of scheduled batches
     * whose platform is still selected. Oldest retry first.
     */
    async findRetryDue(
      limit: number,
    ): Promise<{ publication: SmPublicationRow; item: SmQueueItemRow; batch: SmBatchRow }[]> {
      return db
        .select({ publication: smPublications, item: smQueueItems, batch: smBatches })
        .from(smPublications)
        .innerJoin(smQueueItems, eq(smPublications.itemId, smQueueItems.id))
        .innerJoin(smBatches, eq(smQueueItems.batchId, smBatches.id))
        .where(
          and(
            eq(smPublications.status, 'failed'),
            lte(smPublications.nextAttemptAt, sql`now()`),
            eq(smBatches.status, 'scheduled'),
            eq(smQueueItems.isPaused, false),
            sql`${smPublications.platform}::text = any(${smBatches.platforms})`,
          ),
        )
        .orderBy(smPublications.nextAttemptAt)
        .limit(limit);
    },

    /** Atomically takes a due failed upload for a new attempt. False when someone else did. */
    async reclaim(id: string): Promise<boolean> {
      const rows = await db
        .update(smPublications)
        .set({ ...freshAttempt, attempts: sql`${smPublications.attempts} + 1` })
        .where(
          and(
            eq(smPublications.id, id),
            eq(smPublications.status, 'failed'),
            lte(smPublications.nextAttemptAt, sql`now()`),
          ),
        )
        .returning({ id: smPublications.id });
      return rows.length > 0;
    },

    async setContainer(id: string, containerId: string): Promise<void> {
      await db
        .update(smPublications)
        .set({ containerId: containerId.slice(0, 128) })
        .where(and(eq(smPublications.id, id), eq(smPublications.status, 'processing')));
    },

    async setPublishRequested(id: string): Promise<void> {
      await db
        .update(smPublications)
        .set({ publishRequestedAt: sql`now()` })
        .where(and(eq(smPublications.id, id), eq(smPublications.status, 'processing')));
    },

    async markPublished(
      id: string,
      result: { externalMediaId: string; externalUrl: string | null },
    ): Promise<void> {
      await db
        .update(smPublications)
        .set({
          status: 'published',
          externalMediaId: result.externalMediaId.slice(0, 128),
          externalUrl: result.externalUrl?.slice(0, 500) ?? null,
          errorMessage: null,
          nextAttemptAt: null,
          publishedAt: sql`now()`,
        })
        .where(and(eq(smPublications.id, id), eq(smPublications.status, 'processing')));
    },

    /** `nextAttemptAt` null = no automatic retry. */
    async markFailed(id: string, message: string, nextAttemptAt: Date | null): Promise<void> {
      await db
        .update(smPublications)
        .set({ status: 'failed', errorMessage: message.slice(0, 1000), nextAttemptAt })
        .where(and(eq(smPublications.id, id), eq(smPublications.status, 'processing')));
    },

    /** Attempts still "processing" since before `startedBefore` (the worker died). */
    async findStale(startedBefore: Date): Promise<
      {
        publication: SmPublicationRow;
        batchId: string;
      }[]
    > {
      return db
        .select({ publication: smPublications, batchId: smQueueItems.batchId })
        .from(smPublications)
        .innerJoin(smQueueItems, eq(smPublications.itemId, smQueueItems.id))
        .where(
          and(
            eq(smPublications.status, 'processing'),
            isNotNull(smPublications.startedAt),
            lte(smPublications.startedAt, startedBefore),
          ),
        );
    },

    /** Manual "Coba lagi": the failed upload is taken by the worker on its next round. */
    async requestRetry(itemId: string, platform: Platform): Promise<boolean> {
      const rows = await db
        .update(smPublications)
        .set({ nextAttemptAt: sql`now()` })
        .where(
          and(
            eq(smPublications.itemId, itemId),
            eq(smPublications.platform, platform),
            eq(smPublications.status, 'failed'),
          ),
        )
        .returning({ id: smPublications.id });
      return rows.length > 0;
    },

    /** Forgets failed uploads of a row (it uploads afresh at its new schedule). */
    async deleteFailedForItem(itemId: string): Promise<void> {
      await db
        .delete(smPublications)
        .where(and(eq(smPublications.itemId, itemId), eq(smPublications.status, 'failed')));
    },
  };
}

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
  progressStage: 'downloading',
  progressPercent: null,
  errorMessage: null,
  warningMessage: null,
  nextAttemptAt: null,
  containerId: null,
  publishRequestedAt: null,
};

export interface PublishedItemRef {
  externalMediaId: string;
  topicNumber: number;
  partNumber: number | null;
  title: string;
}

export function createPublicationsRepository(db: DatabaseExecutor) {
  return {
    /** Queue rows of an idea published as these platform media IDs (Performance AIgent). */
    async findPublishedByMediaIds(
      batchId: string,
      platform: Platform,
      mediaIds: readonly string[],
    ): Promise<PublishedItemRef[]> {
      if (mediaIds.length === 0) return [];
      const rows = await db
        .select({
          externalMediaId: smPublications.externalMediaId,
          topicNumber: smQueueItems.topicNumber,
          partNumber: smQueueItems.partNumber,
          title: smQueueItems.title,
        })
        .from(smPublications)
        .innerJoin(smQueueItems, eq(smPublications.itemId, smQueueItems.id))
        .where(
          and(
            eq(smQueueItems.batchId, batchId),
            eq(smPublications.platform, platform),
            inArray(smPublications.externalMediaId, [...mediaIds]),
          ),
        );
      return rows.flatMap((row) =>
        row.externalMediaId ? [{ ...row, externalMediaId: row.externalMediaId }] : [],
      );
    },

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
      result: { externalMediaId: string; externalUrl: string | null; warning?: string | null },
    ): Promise<void> {
      await db
        .update(smPublications)
        .set({
          status: 'published',
          externalMediaId: result.externalMediaId.slice(0, 128),
          externalUrl: result.externalUrl?.slice(0, 500) ?? null,
          errorMessage: null,
          warningMessage: result.warning?.slice(0, 500) ?? null,
          nextAttemptAt: null,
          progressStage: null,
          progressPercent: null,
          publishedAt: sql`now()`,
        })
        .where(and(eq(smPublications.id, id), eq(smPublications.status, 'processing')));
    },

    /** `nextAttemptAt` null = no automatic retry. */
    async markFailed(id: string, message: string, nextAttemptAt: Date | null): Promise<void> {
      await db
        .update(smPublications)
        .set({
          status: 'failed',
          errorMessage: message.slice(0, 1000),
          nextAttemptAt,
          progressStage: null,
          progressPercent: null,
        })
        .where(and(eq(smPublications.id, id), eq(smPublications.status, 'processing')));
    },

    /** Attempts still "processing" since before `startedBefore` (the worker died). */
    async findStale(startedBefore: Date): Promise<
      {
        publication: SmPublicationRow;
        item: SmQueueItemRow;
      }[]
    > {
      return db
        .select({ publication: smPublications, item: smQueueItems })
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

    /**
     * "Unggah sekarang": queues the upload of a row to a platform — a new row, or a
     * failed one taken over. False when it is already queued, uploading or published.
     */
    async queueManual(itemId: string, platform: Platform): Promise<boolean> {
      const queued = {
        status: 'queued' as const,
        progressStage: 'queued',
        progressPercent: null,
        errorMessage: null,
        warningMessage: null,
        nextAttemptAt: null,
      };
      const rows = await db
        .insert(smPublications)
        .values({ itemId, platform, attempts: 0, ...queued })
        .onConflictDoUpdate({
          target: [smPublications.itemId, smPublications.platform],
          set: queued,
          setWhere: eq(smPublications.status, 'failed'),
        })
        .returning({ id: smPublications.id });
      return rows.length > 0;
    },

    /** Manual uploads waiting for the worker, oldest first. */
    async findQueued(
      limit: number,
    ): Promise<{ publication: SmPublicationRow; item: SmQueueItemRow; batch: SmBatchRow }[]> {
      return db
        .select({ publication: smPublications, item: smQueueItems, batch: smBatches })
        .from(smPublications)
        .innerJoin(smQueueItems, eq(smPublications.itemId, smQueueItems.id))
        .innerJoin(smBatches, eq(smQueueItems.batchId, smBatches.id))
        .where(eq(smPublications.status, 'queued'))
        .orderBy(smPublications.updatedAt)
        .limit(limit);
    },

    /** Atomically starts a queued manual upload. False when someone else did. */
    async claimQueued(id: string): Promise<boolean> {
      const rows = await db
        .update(smPublications)
        .set({ ...freshAttempt, attempts: sql`${smPublications.attempts} + 1` })
        .where(and(eq(smPublications.id, id), eq(smPublications.status, 'queued')))
        .returning({ id: smPublications.id });
      return rows.length > 0;
    },

    async setProgress(id: string, stage: string, percent: number | null): Promise<void> {
      await db
        .update(smPublications)
        .set({ progressStage: stage, progressPercent: percent })
        .where(and(eq(smPublications.id, id), eq(smPublications.status, 'processing')));
    },

    /** Forgets failed uploads of a row (it uploads afresh at its new schedule). */
    async deleteFailedForItem(itemId: string): Promise<void> {
      await db
        .delete(smPublications)
        .where(and(eq(smPublications.itemId, itemId), eq(smPublications.status, 'failed')));
    },
  };
}

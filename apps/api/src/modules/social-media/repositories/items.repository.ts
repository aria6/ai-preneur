import {
  and,
  asc,
  eq,
  lte,
  smBatches,
  smQueueItems,
  sql,
  type DatabaseExecutor,
  type SmBatchRow,
  type SmQueueItemRow,
} from '@ai-preneur/database';

export type NewQueueItem = Omit<
  typeof smQueueItems.$inferInsert,
  'id' | 'batchId' | 'createdAt' | 'updatedAt'
>;

export type QueueItemPatch = Partial<
  Pick<
    typeof smQueueItems.$inferInsert,
    | 'position'
    | 'topicNumber'
    | 'partNumber'
    | 'title'
    | 'videoFileId'
    | 'videoFileName'
    | 'thumbnailFileId'
    | 'thumbnailFileName'
    | 'caption'
    | 'hashtags'
    | 'scheduledAt'
    | 'isPaused'
  >
>;

export function createItemsRepository(db: DatabaseExecutor) {
  return {
    async listByBatch(batchId: string): Promise<SmQueueItemRow[]> {
      return db
        .select()
        .from(smQueueItems)
        .where(eq(smQueueItems.batchId, batchId))
        .orderBy(asc(smQueueItems.position), asc(smQueueItems.createdAt), asc(smQueueItems.id));
    },

    async findInBatch(batchId: string, itemId: string): Promise<SmQueueItemRow | undefined> {
      const [row] = await db
        .select()
        .from(smQueueItems)
        .where(and(eq(smQueueItems.id, itemId), eq(smQueueItems.batchId, batchId)))
        .limit(1);
      return row;
    },

    async nextPositionAndTopic(
      batchId: string,
    ): Promise<{ position: number; topicNumber: number }> {
      const [row] = await db
        .select({
          position: sql<number>`coalesce(max(${smQueueItems.position}), -1) + 1`,
          topicNumber: sql<number>`coalesce(max(${smQueueItems.topicNumber}), 0) + 1`,
        })
        .from(smQueueItems)
        .where(eq(smQueueItems.batchId, batchId));
      return { position: Number(row?.position ?? 0), topicNumber: Number(row?.topicNumber ?? 1) };
    },

    async insertMany(batchId: string, items: NewQueueItem[]): Promise<void> {
      if (items.length === 0) return;
      await db.insert(smQueueItems).values(items.map((item) => ({ ...item, batchId })));
    },

    async insert(batchId: string, item: NewQueueItem): Promise<string> {
      const [row] = await db
        .insert(smQueueItems)
        .values({ ...item, batchId })
        .returning({ id: smQueueItems.id });
      if (!row) throw new Error('Insert into sm_queue_items returned no row');
      return row.id;
    },

    async update(itemId: string, patch: QueueItemPatch): Promise<void> {
      if (Object.keys(patch).length === 0) return;
      await db.update(smQueueItems).set(patch).where(eq(smQueueItems.id, itemId));
    },

    async delete(itemId: string): Promise<void> {
      await db.delete(smQueueItems).where(eq(smQueueItems.id, itemId));
    },

    async deleteByBatch(batchId: string): Promise<void> {
      await db.delete(smQueueItems).where(eq(smQueueItems.batchId, batchId));
    },

    /** Rows due for upload: batch scheduled, row active, schedule reached. Oldest first. */
    async findDue(limit: number): Promise<{ item: SmQueueItemRow; batch: SmBatchRow }[]> {
      return db
        .select({ item: smQueueItems, batch: smBatches })
        .from(smQueueItems)
        .innerJoin(smBatches, eq(smQueueItems.batchId, smBatches.id))
        .where(
          and(
            eq(smBatches.status, 'scheduled'),
            eq(smQueueItems.isPaused, false),
            lte(smQueueItems.scheduledAt, sql`now()`),
          ),
        )
        .orderBy(asc(smQueueItems.scheduledAt))
        .limit(limit);
    },
  };
}

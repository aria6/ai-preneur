import {
  and,
  count,
  desc,
  eq,
  inArray,
  smBatches,
  smPublications,
  smQueueItems,
  sql,
  type DatabaseExecutor,
  type SmBatchRow,
} from '@ai-preneur/database';

export interface BatchStats {
  itemCount: number;
  publishedCount: number;
  nextScheduledAt: Date | null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function createBatchesRepository(db: DatabaseExecutor) {
  return {
    async list(): Promise<SmBatchRow[]> {
      return db.select().from(smBatches).orderBy(desc(smBatches.createdAt), desc(smBatches.id));
    },

    async findById(id: string): Promise<SmBatchRow | undefined> {
      const [row] = await db.select().from(smBatches).where(eq(smBatches.id, id)).limit(1);
      return row;
    },

    /** Locks the batch row for the rest of the transaction (serializes concurrent edits). */
    async findByIdForUpdate(id: string): Promise<SmBatchRow | undefined> {
      const [row] = await db
        .select()
        .from(smBatches)
        .where(eq(smBatches.id, id))
        .limit(1)
        .for('update');
      return row;
    },

    async stats(batchIds: string[]): Promise<Map<string, BatchStats>> {
      const result = new Map<string, BatchStats>();
      if (batchIds.length === 0) return result;

      const itemRows = await db
        .select({
          batchId: smQueueItems.batchId,
          total: count(),
          nextAt: sql<unknown>`min(case when not ${smQueueItems.isPaused} and ${smQueueItems.scheduledAt} > now() then ${smQueueItems.scheduledAt} end)`,
        })
        .from(smQueueItems)
        .where(inArray(smQueueItems.batchId, batchIds))
        .groupBy(smQueueItems.batchId);

      const publishedRows = await db
        .select({ batchId: smQueueItems.batchId, total: count() })
        .from(smPublications)
        .innerJoin(smQueueItems, eq(smPublications.itemId, smQueueItems.id))
        .where(and(inArray(smQueueItems.batchId, batchIds), eq(smPublications.status, 'published')))
        .groupBy(smQueueItems.batchId);

      for (const id of batchIds)
        result.set(id, { itemCount: 0, publishedCount: 0, nextScheduledAt: null });
      for (const row of itemRows) {
        const entry = result.get(row.batchId);
        if (entry) {
          entry.itemCount = row.total;
          entry.nextScheduledAt = toDate(row.nextAt);
        }
      }
      for (const row of publishedRows) {
        const entry = result.get(row.batchId);
        if (entry) entry.publishedCount = row.total;
      }
      return result;
    },

    async nextIdeaNumber(): Promise<number> {
      const [row] = await db
        .select({ next: sql<number>`coalesce(max(${smBatches.ideaNumber}), 0) + 1` })
        .from(smBatches);
      return Number(row?.next ?? 1);
    },

    async insert(values: {
      title: string;
      ideaNumber: number;
      driveFolderId: string;
      driveFolderUrl: string;
      platforms: string[];
      createdById: string;
    }): Promise<string> {
      const [row] = await db.insert(smBatches).values(values).returning({ id: smBatches.id });
      if (!row) throw new Error('Insert into sm_batches returned no row');
      return row.id;
    },

    async update(
      id: string,
      patch: Partial<{
        title: string;
        ideaNumber: number;
        driveFolderId: string;
        driveFolderUrl: string;
        platforms: string[];
        status: 'draft' | 'scheduled' | 'completed';
        confirmedAt: Date | null;
      }>,
    ): Promise<void> {
      if (Object.keys(patch).length === 0) return;
      await db.update(smBatches).set(patch).where(eq(smBatches.id, id));
    },

    /**
     * Scheduled batches whose every row (paused ones included) is published on every
     * selected platform become "completed". Returns the IDs that changed.
     */
    async completeFinished(): Promise<string[]> {
      const rows = await db
        .update(smBatches)
        .set({ status: 'completed' })
        .where(
          and(
            eq(smBatches.status, 'scheduled'),
            sql`cardinality(${smBatches.platforms}) > 0`,
            sql`exists (select 1 from ${smQueueItems} where ${smQueueItems.batchId} = ${smBatches.id})`,
            sql`not exists (
              select 1
              from ${smQueueItems}
              cross join unnest(${smBatches.platforms}) as selected(platform)
              where ${smQueueItems.batchId} = ${smBatches.id}
                and not exists (
                  select 1 from ${smPublications}
                  where ${smPublications.itemId} = ${smQueueItems.id}
                    and ${smPublications.platform}::text = selected.platform
                    and ${smPublications.status} = 'published'
                )
            )`,
          ),
        )
        .returning({ id: smBatches.id });
      return rows.map((row) => row.id);
    },

    async delete(id: string): Promise<void> {
      await db.delete(smBatches).where(eq(smBatches.id, id));
    },
  };
}

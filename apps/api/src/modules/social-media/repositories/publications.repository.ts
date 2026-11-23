import {
  and,
  eq,
  inArray,
  smPublications,
  sql,
  type DatabaseExecutor,
  type SmPublicationRow,
} from '@ai-preneur/database';

export function createPublicationsRepository(db: DatabaseExecutor) {
  return {
    async listByItems(itemIds: string[]): Promise<SmPublicationRow[]> {
      if (itemIds.length === 0) return [];
      return db.select().from(smPublications).where(inArray(smPublications.itemId, itemIds));
    },

    /**
     * Atomically reserves the upload of one item to one platform. Returns the new
     * publication ID, or null when it was already claimed (by this or another worker,
     * now or in the past) — the unique (item, platform) index makes this race-free.
     */
    async claim(itemId: string, platform: SmPublicationRow['platform']): Promise<string | null> {
      const [row] = await db
        .insert(smPublications)
        .values({ itemId, platform, status: 'processing', attempts: 1, startedAt: sql`now()` })
        .onConflictDoNothing({ target: [smPublications.itemId, smPublications.platform] })
        .returning({ id: smPublications.id });
      return row?.id ?? null;
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
          publishedAt: sql`now()`,
        })
        .where(and(eq(smPublications.id, id), eq(smPublications.status, 'processing')));
    },

    async markFailed(id: string, message: string): Promise<void> {
      await db
        .update(smPublications)
        .set({ status: 'failed', errorMessage: message.slice(0, 1000) })
        .where(and(eq(smPublications.id, id), eq(smPublications.status, 'processing')));
    },
  };
}

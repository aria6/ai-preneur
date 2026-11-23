import { and, eq, smAccounts, sql, type DatabaseExecutor, type SmAccountRow } from '@ai-preneur/database';

export type AccountPlatform = SmAccountRow['platform'];

export function createAccountsRepository(db: DatabaseExecutor) {
  return {
    async listByBatch(batchId: string): Promise<SmAccountRow[]> {
      return db.select().from(smAccounts).where(eq(smAccounts.batchId, batchId));
    },

    async findForBatch(batchId: string, platform: AccountPlatform): Promise<SmAccountRow | undefined> {
      const [row] = await db
        .select()
        .from(smAccounts)
        .where(and(eq(smAccounts.batchId, batchId), eq(smAccounts.platform, platform)))
        .limit(1);
      return row;
    },

    /**
     * Connects (or reconnects) the idea's account for a platform. Throws a unique
     * violation when that platform account already belongs to another idea.
     */
    async upsertForBatch(values: {
      batchId: string;
      platform: AccountPlatform;
      externalAccountId: string;
      username: string | null;
      accountType: string | null;
      encryptedCredentials: string;
    }): Promise<void> {
      await db
        .insert(smAccounts)
        .values({ ...values, status: 'connected', lastError: null, lastCheckedAt: sql`now()` })
        .onConflictDoUpdate({
          target: [smAccounts.batchId, smAccounts.platform],
          set: {
            externalAccountId: values.externalAccountId,
            username: values.username,
            accountType: values.accountType,
            encryptedCredentials: values.encryptedCredentials,
            status: 'connected',
            lastError: null,
            tokenExpiresAt: null,
            lastCheckedAt: sql`now()`,
          },
        });
    },

    async deleteForBatch(batchId: string, platform: AccountPlatform): Promise<void> {
      await db.delete(smAccounts).where(and(eq(smAccounts.batchId, batchId), eq(smAccounts.platform, platform)));
    },
  };
}

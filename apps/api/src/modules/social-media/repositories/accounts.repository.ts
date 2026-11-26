import {
  and,
  eq,
  inArray,
  isNull,
  lt,
  or,
  smAccounts,
  smBatches,
  sql,
  type DatabaseExecutor,
  type SmAccountRow,
} from '@ai-preneur/database';

export type AccountPlatform = SmAccountRow['platform'];

export function createAccountsRepository(db: DatabaseExecutor) {
  return {
    async listByBatch(batchId: string): Promise<SmAccountRow[]> {
      return db.select().from(smAccounts).where(eq(smAccounts.batchId, batchId));
    },

    async listByBatches(batchIds: readonly string[]): Promise<SmAccountRow[]> {
      if (batchIds.length === 0) return [];
      return db
        .select()
        .from(smAccounts)
        .where(inArray(smAccounts.batchId, [...batchIds]));
    },

    async findForBatch(
      batchId: string,
      platform: AccountPlatform,
    ): Promise<SmAccountRow | undefined> {
      const [row] = await db
        .select()
        .from(smAccounts)
        .where(and(eq(smAccounts.batchId, batchId), eq(smAccounts.platform, platform)))
        .limit(1);
      return row;
    },

    /** Accounts of a platform with one of these platform account IDs (any idea). */
    async findByExternalIds(
      platform: AccountPlatform,
      externalAccountIds: readonly string[],
    ): Promise<SmAccountRow[]> {
      if (externalAccountIds.length === 0) return [];
      return db
        .select()
        .from(smAccounts)
        .where(
          and(
            eq(smAccounts.platform, platform),
            inArray(smAccounts.externalAccountId, [...externalAccountIds]),
          ),
        );
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

    /**
     * Accounts of unfinished batches whose token should be refreshed or checked: not
     * checked for 24 h (Instagram refuses younger tokens) and with no known expiry
     * (unknown, or a token that never expires) or one closer than `refreshWithinDays`.
     */
    async findDueForRefresh(
      platform: AccountPlatform,
      refreshWithinDays: number,
    ): Promise<SmAccountRow[]> {
      return db
        .select({ account: smAccounts })
        .from(smAccounts)
        .innerJoin(smBatches, eq(smAccounts.batchId, smBatches.id))
        .where(
          and(
            eq(smAccounts.platform, platform),
            eq(smAccounts.status, 'connected'),
            inArray(smBatches.status, ['draft', 'scheduled']),
            lt(smAccounts.lastCheckedAt, sql`now() - interval '24 hours'`),
            or(
              isNull(smAccounts.tokenExpiresAt),
              lt(
                smAccounts.tokenExpiresAt,
                sql`now() + make_interval(days => ${refreshWithinDays})`,
              ),
            ),
          ),
        )
        .then((rows) => rows.map((row) => row.account));
    },

    /**
     * Stores a refreshed (or re-checked) token — only if nobody reconnected the account
     * meanwhile. `tokenExpiresAt: null` = the token never expires.
     */
    async replaceCredentials(
      id: string,
      previousEncrypted: string,
      encryptedCredentials: string,
      tokenExpiresAt: Date | null,
    ): Promise<void> {
      await db
        .update(smAccounts)
        .set({
          encryptedCredentials,
          tokenExpiresAt,
          status: 'connected',
          lastError: null,
          lastCheckedAt: sql`now()`,
        })
        .where(and(eq(smAccounts.id, id), eq(smAccounts.encryptedCredentials, previousEncrypted)));
    },

    /** Records a check that changed nothing (e.g. a temporary refresh failure). */
    async touch(id: string): Promise<void> {
      await db
        .update(smAccounts)
        .set({ lastCheckedAt: sql`now()` })
        .where(eq(smAccounts.id, id));
    },

    /** The token no longer works: the idea must reconnect the account. */
    async markError(id: string, message: string, previousEncrypted?: string): Promise<void> {
      await db
        .update(smAccounts)
        .set({ status: 'error', lastError: message.slice(0, 500), lastCheckedAt: sql`now()` })
        .where(
          previousEncrypted
            ? and(eq(smAccounts.id, id), eq(smAccounts.encryptedCredentials, previousEncrypted))
            : eq(smAccounts.id, id),
        );
    },

    async deleteForBatch(batchId: string, platform: AccountPlatform): Promise<void> {
      await db
        .delete(smAccounts)
        .where(and(eq(smAccounts.batchId, batchId), eq(smAccounts.platform, platform)));
    },
  };
}

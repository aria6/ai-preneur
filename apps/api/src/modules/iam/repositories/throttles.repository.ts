import {
  and,
  eq,
  gt,
  inArray,
  loginThrottles,
  sql,
  type DatabaseExecutor,
} from '@ai-preneur/database';

export function createThrottlesRepository(db: DatabaseExecutor) {
  return {
    /** Latest active lock across the given keys, or null. */
    async findActiveLock(keys: string[]): Promise<Date | null> {
      if (keys.length === 0) return null;
      const rows = await db
        .select({ lockedUntil: loginThrottles.lockedUntil })
        .from(loginThrottles)
        .where(and(inArray(loginThrottles.key, keys), gt(loginThrottles.lockedUntil, sql`now()`)));
      let latest: Date | null = null;
      for (const row of rows) {
        if (row.lockedUntil && (!latest || row.lockedUntil > latest)) latest = row.lockedUntil;
      }
      return latest;
    },

    /**
     * Atomically counts one failure within a fixed window (upsert), and locks the
     * key once `maxAttempts` is reached. Returns the attempts in the current window.
     */
    async registerFailure(
      key: string,
      policy: { maxAttempts: number; windowSeconds: number; lockSeconds: number },
    ): Promise<number> {
      const windowExpired = sql`${loginThrottles.windowStartedAt} <= now() - (${policy.windowSeconds}::int * interval '1 second')`;

      const [row] = await db
        .insert(loginThrottles)
        .values({ key, attempts: 1, windowStartedAt: sql`now()` })
        .onConflictDoUpdate({
          target: loginThrottles.key,
          set: {
            attempts: sql`case when ${windowExpired} then 1 else ${loginThrottles.attempts} + 1 end`,
            windowStartedAt: sql`case when ${windowExpired} then now() else ${loginThrottles.windowStartedAt} end`,
          },
        })
        .returning({ attempts: loginThrottles.attempts });

      const attempts = row?.attempts ?? 1;
      if (attempts >= policy.maxAttempts) {
        await db
          .update(loginThrottles)
          .set({
            lockedUntil: sql`now() + (${policy.lockSeconds}::int * interval '1 second')`,
            attempts: 0,
            windowStartedAt: sql`now()`,
          })
          .where(eq(loginThrottles.key, key));
      }
      return attempts;
    },

    async reset(key: string): Promise<void> {
      await db.delete(loginThrottles).where(eq(loginThrottles.key, key));
    },
  };
}

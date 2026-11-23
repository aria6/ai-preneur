import {
  and,
  eq,
  gt,
  lt,
  ne,
  roles,
  sessions,
  sql,
  users,
  type DatabaseExecutor,
} from '@ai-preneur/database';

export interface ActiveSessionRow {
  sessionId: string;
  lastSeenAt: Date;
  userId: string;
  email: string;
  name: string;
  isActive: boolean;
  roleId: string;
  roleName: string;
  roleIsSystem: boolean;
}

export function createSessionsRepository(db: DatabaseExecutor) {
  return {
    /** Expiry uses the database clock: `now() + ttl`. */
    async create(values: {
      userId: string;
      tokenHash: string;
      ttlHours: number;
      ipAddress: string | null;
      userAgent: string | null;
    }): Promise<string> {
      const [row] = await db
        .insert(sessions)
        .values({
          userId: values.userId,
          tokenHash: values.tokenHash,
          ipAddress: values.ipAddress,
          userAgent: values.userAgent,
          expiresAt: sql`now() + (${values.ttlHours}::int * interval '1 hour')`,
        })
        .returning({ id: sessions.id });
      if (!row) throw new Error('Insert into sessions returned no row');
      return row.id;
    },

    /**
     * Returns the session only if it is still valid:
     *   - not past its absolute expiry,
     *   - used within the idle timeout,
     *   - created after the user's last password change.
     * Activeness of the user is returned (not filtered) so the caller can revoke.
     */
    async findValidByTokenHash(
      tokenHash: string,
      idleTimeoutMinutes: number,
    ): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          sessionId: sessions.id,
          lastSeenAt: sessions.lastSeenAt,
          userId: users.id,
          email: users.email,
          name: users.name,
          isActive: users.isActive,
          roleId: roles.id,
          roleName: roles.name,
          roleIsSystem: roles.isSystem,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(
          and(
            eq(sessions.tokenHash, tokenHash),
            gt(sessions.expiresAt, sql`now()`),
            gt(
              sessions.lastSeenAt,
              sql`now() - (${idleTimeoutMinutes}::int * interval '1 minute')`,
            ),
            sql`${sessions.createdAt} >= ${users.passwordChangedAt}`,
          ),
        )
        .limit(1);
      return row;
    },

    /** Records activity, throttled to one write per minute per session. */
    async touch(sessionId: string): Promise<void> {
      await db
        .update(sessions)
        .set({ lastSeenAt: sql`now()` })
        .where(
          and(
            eq(sessions.id, sessionId),
            lt(sessions.lastSeenAt, sql`now() - interval '1 minute'`),
          ),
        );
    },

    async deleteById(sessionId: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    },

    async deleteByTokenHash(tokenHash: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },

    async deleteAllForUser(userId: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.userId, userId));
    },

    async deleteOthersForUser(userId: string, keepSessionId: string): Promise<void> {
      await db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
    },

    /** Housekeeping on login: drop the user's dead sessions. */
    async deleteExpiredForUser(userId: string): Promise<void> {
      await db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, sql`now()`)));
    },
  };
}

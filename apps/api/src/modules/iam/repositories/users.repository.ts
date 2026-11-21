import {
  and,
  count,
  desc,
  eq,
  ilike,
  ne,
  or,
  roles,
  sql,
  users,
  type DatabaseExecutor,
} from '@ai-preneur/database';

export interface UserWithRoleRow {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  roleId: string;
  roleName: string;
  roleIsSystem: boolean;
}

const userWithRoleColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  roleId: roles.id,
  roleName: roles.name,
  roleIsSystem: roles.isSystem,
};

/** Escapes LIKE wildcards so user search input is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function createUsersRepository(db: DatabaseExecutor) {
  return {
    async findById(id: string): Promise<UserWithRoleRow | undefined> {
      const [row] = await db
        .select(userWithRoleColumns)
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(eq(users.id, id))
        .limit(1);
      return row;
    },

    async findCredentialsByEmail(
      email: string,
    ): Promise<{ id: string; passwordHash: string; isActive: boolean } | undefined> {
      const [row] = await db
        .select({ id: users.id, passwordHash: users.passwordHash, isActive: users.isActive })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return row;
    },

    async findPasswordHash(id: string): Promise<string | undefined> {
      const [row] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return row?.passwordHash;
    },

    async existsByEmail(email: string): Promise<boolean> {
      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      return row !== undefined;
    },

    async list(params: {
      page: number;
      pageSize: number;
      search?: string | undefined;
    }): Promise<{ items: UserWithRoleRow[]; total: number }> {
      const term = params.search ? `%${escapeLike(params.search)}%` : undefined;
      const where = term ? or(ilike(users.name, term), ilike(users.email, term)) : undefined;

      const items = await db
        .select(userWithRoleColumns)
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(params.pageSize)
        .offset((params.page - 1) * params.pageSize);

      const [totals] = await db.select({ total: count() }).from(users).where(where);
      return { items, total: totals?.total ?? 0 };
    },

    async insert(values: {
      email: string;
      name: string;
      passwordHash: string;
      roleId: string;
      isActive: boolean;
    }): Promise<string> {
      const [row] = await db.insert(users).values(values).returning({ id: users.id });
      if (!row) throw new Error('Insert into users returned no row');
      return row.id;
    },

    async update(
      id: string,
      patch: { name?: string | undefined; roleId?: string | undefined; isActive?: boolean | undefined },
    ): Promise<void> {
      const set: Partial<typeof users.$inferInsert> = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.roleId !== undefined) set.roleId = patch.roleId;
      if (patch.isActive !== undefined) set.isActive = patch.isActive;
      if (Object.keys(set).length === 0) return;
      await db.update(users).set(set).where(eq(users.id, id));
    },

    /**
     * Replaces the password hash and bumps passwordChangedAt to the database clock,
     * which invalidates every session created before this statement.
     */
    async updatePassword(id: string, passwordHash: string): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: sql`now()` })
        .where(eq(users.id, id));
    },

    /** Silent hash upgrade; does not touch passwordChangedAt (sessions stay valid). */
    async upgradePasswordHash(id: string, passwordHash: string): Promise<void> {
      await db.update(users).set({ passwordHash }).where(eq(users.id, id));
    },

    async touchLastLogin(id: string): Promise<void> {
      await db.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, id));
    },

    async delete(id: string): Promise<void> {
      await db.delete(users).where(eq(users.id, id));
    },

    /** Active users holding a system role, optionally excluding one user. */
    async countActiveSystemUsers(excludeUserId?: string): Promise<number> {
      const conditions = [eq(users.isActive, true), eq(roles.isSystem, true)];
      if (excludeUserId) conditions.push(ne(users.id, excludeUserId));
      const [row] = await db
        .select({ total: count() })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(and(...conditions));
      return row?.total ?? 0;
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;

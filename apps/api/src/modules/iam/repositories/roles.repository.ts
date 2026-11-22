import {
  asc,
  count,
  eq,
  inArray,
  rolePermissions,
  roles,
  sql,
  users,
  type DatabaseExecutor,
} from '@ai-preneur/database';
import { isPermission, type Permission } from '@ai-preneur/shared';

export interface RoleRecord {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const roleColumns = {
  id: roles.id,
  name: roles.name,
  description: roles.description,
  isSystem: roles.isSystem,
  createdAt: roles.createdAt,
  updatedAt: roles.updatedAt,
};

export function createRolesRepository(db: DatabaseExecutor) {
  async function permissionsByRole(roleIds: string[]): Promise<Map<string, Permission[]>> {
    const map = new Map<string, Permission[]>();
    if (roleIds.length === 0) return map;
    const rows = await db
      .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, roleIds));
    for (const row of rows) {
      // Keys removed from the code catalog are ignored even if still in the DB.
      if (!isPermission(row.key)) continue;
      const list = map.get(row.roleId) ?? [];
      list.push(row.key);
      map.set(row.roleId, list);
    }
    return map;
  }

  async function userCountsByRole(roleIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (roleIds.length === 0) return map;
    const rows = await db
      .select({ roleId: users.roleId, total: count() })
      .from(users)
      .where(inArray(users.roleId, roleIds))
      .groupBy(users.roleId);
    for (const row of rows) map.set(row.roleId, row.total);
    return map;
  }

  return {
    async list(): Promise<RoleRecord[]> {
      const rows = await db
        .select(roleColumns)
        .from(roles)
        .orderBy(sql`${roles.isSystem} desc`, asc(roles.name));
      const ids = rows.map((row) => row.id);
      const [perms, counts] = await Promise.all([permissionsByRole(ids), userCountsByRole(ids)]);
      return rows.map((row) => ({
        ...row,
        permissions: perms.get(row.id) ?? [],
        userCount: counts.get(row.id) ?? 0,
      }));
    },

    async findById(id: string): Promise<RoleRecord | undefined> {
      const [row] = await db.select(roleColumns).from(roles).where(eq(roles.id, id)).limit(1);
      if (!row) return undefined;
      const [perms, counts] = await Promise.all([permissionsByRole([id]), userCountsByRole([id])]);
      return { ...row, permissions: perms.get(id) ?? [], userCount: counts.get(id) ?? 0 };
    },

    async findPermissions(roleId: string): Promise<Permission[]> {
      return (await permissionsByRole([roleId])).get(roleId) ?? [];
    },

    /** Case-insensitive name lookup (matches the roles_name_lower_unique index). */
    async findIdByName(name: string): Promise<string | undefined> {
      const [row] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(sql`lower(${roles.name}) = lower(${name})`)
        .limit(1);
      return row?.id;
    },

    async insert(values: {
      name: string;
      description: string | null;
      isSystem?: boolean;
    }): Promise<string> {
      const [row] = await db
        .insert(roles)
        .values({ name: values.name, description: values.description, isSystem: values.isSystem ?? false })
        .returning({ id: roles.id });
      if (!row) throw new Error('Insert into roles returned no row');
      return row.id;
    },

    async update(
      id: string,
      patch: { name?: string | undefined; description?: string | null | undefined },
    ): Promise<void> {
      const set: Partial<typeof roles.$inferInsert> = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.description !== undefined) set.description = patch.description;
      if (Object.keys(set).length === 0) {
        // Still bump updatedAt when only permissions changed.
        await db.update(roles).set({ updatedAt: sql`now()` }).where(eq(roles.id, id));
        return;
      }
      await db.update(roles).set(set).where(eq(roles.id, id));
    },

    /** Replaces the role's permission set. Call inside a transaction. */
    async replacePermissions(roleId: string, permissions: readonly Permission[]): Promise<void> {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (permissions.length === 0) return;
      await db
        .insert(rolePermissions)
        .values(permissions.map((permissionKey) => ({ roleId, permissionKey })));
    },

    async delete(id: string): Promise<void> {
      await db.delete(roles).where(eq(roles.id, id));
    },
  };
}

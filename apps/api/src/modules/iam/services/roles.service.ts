import { isForeignKeyViolation, isUniqueViolation, type Database } from '@ai-preneur/database';
import type { CreateRoleRequest, Permission, RoleDto, UpdateRoleRequest } from '@ai-preneur/shared';

import { conflict, fieldError, forbidden, notFound } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import { canActOnRole, canGrantAll, type AuthContext } from '../access-policy.js';
import { toRoleDto } from '../iam.mappers.js';
import { createRolesRepository, type RoleRecord } from '../repositories/roles.repository.js';

const NAME_TAKEN = 'Nama role sudah digunakan.';

/** Role & permission management with privilege-escalation guards. */
export function createRolesService(deps: { db: Database; logger: Logger }) {
  const { db, logger } = deps;
  const roles = createRolesRepository(db);

  async function getRoleOrThrow(id: string): Promise<RoleRecord> {
    const role = await roles.findById(id);
    if (!role) throw notFound('Role tidak ditemukan.');
    return role;
  }

  function assertCanGrant(ctx: AuthContext, permissions: readonly Permission[]): void {
    if (!canGrantAll(ctx, permissions)) {
      throw forbidden('Anda tidak dapat memberikan hak akses yang tidak Anda miliki.');
    }
  }

  /** Mutations are refused for system roles, the actor's own role and more powerful roles. */
  function assertCanModify(ctx: AuthContext, role: RoleRecord): void {
    if (role.isSystem) throw forbidden('Role sistem tidak dapat diubah atau dihapus.');
    if (role.id === ctx.user.roleId) throw forbidden('Anda tidak dapat mengubah role Anda sendiri.');
    if (!canActOnRole(ctx, role)) {
      throw forbidden('Anda tidak dapat mengelola role dengan hak akses melebihi milik Anda.');
    }
  }

  async function assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const existingId = await roles.findIdByName(name);
    if (existingId && existingId !== exceptId) throw fieldError('name', NAME_TAKEN);
  }

  return {
    async list(): Promise<RoleDto[]> {
      return (await roles.list()).map(toRoleDto);
    },

    async get(id: string): Promise<RoleDto> {
      return toRoleDto(await getRoleOrThrow(id));
    },

    async create(ctx: AuthContext, input: CreateRoleRequest): Promise<RoleDto> {
      assertCanGrant(ctx, input.permissions);
      await assertNameAvailable(input.name);

      let id: string;
      try {
        id = await db.transaction(async (tx) => {
          const txRoles = createRolesRepository(tx);
          const newId = await txRoles.insert({ name: input.name, description: input.description ?? null });
          await txRoles.replacePermissions(newId, input.permissions);
          return newId;
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw fieldError('name', NAME_TAKEN);
        throw error;
      }

      logger.info('Role created', { actorId: ctx.user.id, roleId: id });
      return toRoleDto(await getRoleOrThrow(id));
    },

    async update(ctx: AuthContext, id: string, input: UpdateRoleRequest): Promise<RoleDto> {
      const role = await getRoleOrThrow(id);
      assertCanModify(ctx, role);
      if (input.permissions) assertCanGrant(ctx, input.permissions);
      if (input.name !== undefined) await assertNameAvailable(input.name, id);

      try {
        await db.transaction(async (tx) => {
          const txRoles = createRolesRepository(tx);
          await txRoles.update(id, { name: input.name, description: input.description });
          if (input.permissions) await txRoles.replacePermissions(id, input.permissions);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw fieldError('name', NAME_TAKEN);
        throw error;
      }

      logger.info('Role updated', { actorId: ctx.user.id, roleId: id, fields: Object.keys(input) });
      return toRoleDto(await getRoleOrThrow(id));
    },

    async delete(ctx: AuthContext, id: string): Promise<void> {
      const role = await getRoleOrThrow(id);
      assertCanModify(ctx, role);
      if (role.userCount > 0) {
        throw conflict(
          `Role masih digunakan oleh ${role.userCount} pengguna. Pindahkan pengguna ke role lain terlebih dahulu.`,
        );
      }
      try {
        await roles.delete(id);
      } catch (error) {
        // A user was assigned concurrently; users.role_id is ON DELETE RESTRICT.
        if (isForeignKeyViolation(error)) throw conflict('Role masih digunakan oleh pengguna.');
        throw error;
      }
      logger.info('Role deleted', { actorId: ctx.user.id, roleId: id });
    },
  };
}

export type RolesService = ReturnType<typeof createRolesService>;

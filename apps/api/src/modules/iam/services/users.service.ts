import { isUniqueViolation, type Database } from '@ai-preneur/database';
import type {
  CreateUserRequest,
  ListUsersQuery,
  ResetUserPasswordRequest,
  UpdateUserRequest,
  UserDto,
  UserListResponse,
} from '@ai-preneur/shared';

import { conflict, fieldError, forbidden, notFound } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import { canActOnRole, type AuthContext } from '../access-policy.js';
import { toUserDto } from '../iam.mappers.js';
import { createRolesRepository, type RoleRecord } from '../repositories/roles.repository.js';
import { createSessionsRepository } from '../repositories/sessions.repository.js';
import { createUsersRepository, type UserWithRoleRow } from '../repositories/users.repository.js';
import { hashPassword } from '../security/password.js';

const EMAIL_TAKEN = 'Email sudah digunakan oleh pengguna lain.';
const LAST_SUPER_ADMIN = 'Harus ada minimal satu pengguna aktif dengan role sistem.';

/** Administrative user management. Every mutation goes through the access policy. */
export function createUsersService(deps: { db: Database; logger: Logger }) {
  const { db, logger } = deps;
  const users = createUsersRepository(db);
  const roles = createRolesRepository(db);

  async function getUserOrThrow(id: string): Promise<UserWithRoleRow> {
    const user = await users.findById(id);
    if (!user) throw notFound('Pengguna tidak ditemukan.');
    return user;
  }

  async function getAssignableRole(ctx: AuthContext, roleId: string): Promise<RoleRecord> {
    const role = await roles.findById(roleId);
    if (!role) throw fieldError('roleId', 'Role tidak ditemukan.');
    if (!canActOnRole(ctx, role)) {
      throw forbidden('Anda tidak dapat memberikan role dengan hak akses melebihi milik Anda.');
    }
    return role;
  }

  /** Loads a target user and checks the actor may manage them at all. */
  async function getManageableUser(ctx: AuthContext, id: string): Promise<UserWithRoleRow> {
    if (id === ctx.user.id) {
      throw forbidden('Gunakan halaman Profil untuk mengubah akun Anda sendiri.');
    }
    const target = await getUserOrThrow(id);
    const targetRole = await roles.findById(target.roleId);
    if (!targetRole || !canActOnRole(ctx, targetRole)) {
      throw forbidden('Anda tidak dapat mengelola pengguna dengan hak akses melebihi milik Anda.');
    }
    return target;
  }

  return {
    async list(query: ListUsersQuery): Promise<UserListResponse> {
      const { items, total } = await users.list(query);
      return { items: items.map(toUserDto), page: query.page, pageSize: query.pageSize, total };
    },

    async get(id: string): Promise<UserDto> {
      return toUserDto(await getUserOrThrow(id));
    },

    async create(ctx: AuthContext, input: CreateUserRequest): Promise<UserDto> {
      await getAssignableRole(ctx, input.roleId);
      if (await users.existsByEmail(input.email)) throw fieldError('email', EMAIL_TAKEN);

      const passwordHash = await hashPassword(input.password);
      let id: string;
      try {
        id = await users.insert({
          email: input.email,
          name: input.name,
          passwordHash,
          roleId: input.roleId,
          isActive: input.isActive,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw fieldError('email', EMAIL_TAKEN);
        throw error;
      }

      logger.info('User created', { actorId: ctx.user.id, userId: id });
      return toUserDto(await getUserOrThrow(id));
    },

    async update(ctx: AuthContext, id: string, input: UpdateUserRequest): Promise<UserDto> {
      const target = await getManageableUser(ctx, id);
      const newRole = input.roleId ? await getAssignableRole(ctx, input.roleId) : undefined;

      const losesSystemAccess =
        target.roleIsSystem &&
        target.isActive &&
        (input.isActive === false || (newRole !== undefined && !newRole.isSystem));

      await db.transaction(async (tx) => {
        const txUsers = createUsersRepository(tx);
        if (losesSystemAccess && (await txUsers.countActiveSystemUsers(target.id)) === 0) {
          throw conflict(LAST_SUPER_ADMIN);
        }
        await txUsers.update(id, { name: input.name, roleId: input.roleId, isActive: input.isActive });
        // A deactivated user is logged out everywhere immediately.
        if (input.isActive === false) await createSessionsRepository(tx).deleteAllForUser(id);
      });

      logger.info('User updated', { actorId: ctx.user.id, userId: id, fields: Object.keys(input) });
      return toUserDto(await getUserOrThrow(id));
    },

    async resetPassword(ctx: AuthContext, id: string, input: ResetUserPasswordRequest): Promise<void> {
      await getManageableUser(ctx, id);
      const passwordHash = await hashPassword(input.newPassword);
      await db.transaction(async (tx) => {
        await createUsersRepository(tx).updatePassword(id, passwordHash);
        await createSessionsRepository(tx).deleteAllForUser(id);
      });
      logger.info('User password reset by administrator', { actorId: ctx.user.id, userId: id });
    },

    async delete(ctx: AuthContext, id: string): Promise<void> {
      const target = await getManageableUser(ctx, id);
      await db.transaction(async (tx) => {
        const txUsers = createUsersRepository(tx);
        if (target.roleIsSystem && target.isActive && (await txUsers.countActiveSystemUsers(target.id)) === 0) {
          throw conflict(LAST_SUPER_ADMIN);
        }
        await txUsers.delete(id); // sessions are removed by ON DELETE CASCADE
      });
      logger.info('User deleted', { actorId: ctx.user.id, userId: id });
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;

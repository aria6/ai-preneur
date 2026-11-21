import type { AuthUser, RoleDto, UserDto } from '@ai-preneur/shared';

import type { AuthContext } from './access-policy.js';
import type { RoleRecord } from './repositories/roles.repository.js';
import type { UserWithRoleRow } from './repositories/users.repository.js';

/** Explicit field-by-field mapping: secrets such as passwordHash can never leak into a DTO. */

export function toAuthUser(ctx: AuthContext): AuthUser {
  return {
    id: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
    role: { id: ctx.user.roleId, name: ctx.user.roleName, isSystem: ctx.user.isSystemRole },
    permissions: [...ctx.permissions].sort(),
  };
}

export function toUserDto(row: UserWithRoleRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isActive: row.isActive,
    role: { id: row.roleId, name: row.roleName, isSystem: row.roleIsSystem },
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toRoleDto(role: RoleRecord): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: [...role.permissions].sort(),
    userCount: role.userCount,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

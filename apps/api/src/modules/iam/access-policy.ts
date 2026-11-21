import { ALL_PERMISSIONS, type Permission } from '@ai-preneur/shared';

/**
 * Authorization rules shared by all IAM services.
 *
 * Core invariant — NO PRIVILEGE ESCALATION: an actor can never create, grant,
 * assign or manage access greater than their own. Concretely an actor may only:
 *   - grant permissions they hold themselves,
 *   - assign a role whose permissions they all hold,
 *   - manage a user whose role they could assign,
 *   - touch system roles / system-role users if they are in a system role.
 * Actors also cannot modify their own role or their own account through admin
 * endpoints (they use /profile for their own name and password).
 */

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  isSystemRole: boolean;
}

export interface AuthContext {
  sessionId: string;
  user: AuthenticatedUser;
  permissions: ReadonlySet<Permission>;
}

/** What is needed to reason about a role's power. */
export interface RoleScope {
  isSystem: boolean;
  permissions: readonly Permission[];
}

export function effectivePermissions(role: RoleScope): Permission[] {
  return role.isSystem ? [...ALL_PERMISSIONS] : [...role.permissions];
}

export function hasPermission(ctx: AuthContext, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function canGrantAll(ctx: AuthContext, permissions: Iterable<Permission>): boolean {
  if (ctx.user.isSystemRole) return true;
  for (const permission of permissions) {
    if (!ctx.permissions.has(permission)) return false;
  }
  return true;
}

/** True when the actor's power is a superset of the role's power. */
export function canActOnRole(ctx: AuthContext, role: RoleScope): boolean {
  if (role.isSystem) return ctx.user.isSystemRole;
  return canGrantAll(ctx, role.permissions);
}

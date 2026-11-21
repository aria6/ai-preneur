import type { AuthUser, RoleDto } from '@ai-preneur/shared';

/**
 * Mirrors the API's anti-escalation rule so the UI only offers allowed actions.
 * The API enforces it independently — this is purely for a better UX.
 */
export function canActOnRole(actor: AuthUser, role: Pick<RoleDto, 'isSystem' | 'permissions'>): boolean {
  if (role.isSystem) return actor.role.isSystem;
  if (actor.role.isSystem) return true;
  return role.permissions.every((permission) => actor.permissions.includes(permission));
}

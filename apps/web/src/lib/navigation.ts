import { PERMISSIONS, type Permission } from '@ai-preneur/shared';

export type NavIcon = 'dashboard' | 'users' | 'roles';

export interface NavItem {
  to: string;
  label: string;
  icon: NavIcon;
  /** Shown only to users holding this permission. */
  permission: Permission;
}

/** Sidebar entries, in display order. Add new feature pages here. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: PERMISSIONS.DASHBOARD_VIEW },
  { to: '/users', label: 'Pengguna', icon: 'users', permission: PERMISSIONS.USERS_VIEW },
  { to: '/roles', label: 'Role & Akses', icon: 'roles', permission: PERMISSIONS.ROLES_VIEW },
];

/** Landing page after login: the first page the user may open, else the profile. */
export function homePathFor(can: (permission: Permission) => boolean): string {
  return NAV_ITEMS.find((item) => can(item.permission))?.to ?? '/profile';
}

/** Only same-app relative paths are followed after login (prevents open redirects). */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return null;
  }
  return value.startsWith('/login') ? null : value;
}

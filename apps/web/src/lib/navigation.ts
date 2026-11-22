import { PERMISSIONS, type Permission } from '@ai-preneur/shared';

export type NavIcon = 'dashboard' | 'users' | 'roles' | 'system';

export interface NavLinkItem {
  type: 'link';
  to: string;
  label: string;
  icon: NavIcon;
  /** Shown only to users holding this permission. */
  permission: Permission;
}

export interface NavGroupItem {
  type: 'group';
  id: string;
  label: string;
  icon: NavIcon;
  /** The group is shown only if at least one child is visible. */
  children: readonly NavLinkItem[];
}

export type NavEntry = NavLinkItem | NavGroupItem;

/** Sidebar structure, in display order. Add new feature pages here. */
export const NAV_ENTRIES: readonly NavEntry[] = [
  {
    type: 'link',
    to: '/dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    permission: PERMISSIONS.DASHBOARD_VIEW,
  },
  {
    type: 'group',
    id: 'system',
    label: 'Sistem',
    icon: 'system',
    children: [
      { type: 'link', to: '/users', label: 'Pengguna', icon: 'users', permission: PERMISSIONS.USERS_VIEW },
      { type: 'link', to: '/roles', label: 'Role & Akses', icon: 'roles', permission: PERMISSIONS.ROLES_VIEW },
    ],
  },
];

/** All navigable pages, flattened (groups expanded). */
export const NAV_LINKS: readonly NavLinkItem[] = NAV_ENTRIES.flatMap((entry) =>
  entry.type === 'group' ? entry.children : [entry],
);

/** Entries filtered by permission; empty groups are dropped. */
export function visibleNavEntries(can: (permission: Permission) => boolean): NavEntry[] {
  return NAV_ENTRIES.flatMap((entry): NavEntry[] => {
    if (entry.type === 'link') return can(entry.permission) ? [entry] : [];
    const children = entry.children.filter((child) => can(child.permission));
    return children.length > 0 ? [{ ...entry, children }] : [];
  });
}

export function isPathActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Landing page after login: the first page the user may open, else the profile. */
export function homePathFor(can: (permission: Permission) => boolean): string {
  return NAV_LINKS.find((item) => can(item.permission))?.to ?? '/profile';
}

/** Only same-app relative paths are followed after login (prevents open redirects). */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return null;
  }
  return value.startsWith('/login') ? null : value;
}

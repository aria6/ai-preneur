import { PERMISSIONS, type Permission } from '@ai-preneur/shared';

export type NavIcon =
  'dashboard' | 'users' | 'roles' | 'system' | 'megaphone' | 'chart' | 'search' | 'settings';

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
  /** Links or sub-groups. The group is shown only if at least one child is visible. */
  children: readonly NavEntry[];
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
    id: 'social-media',
    label: 'Social Media AIgency',
    icon: 'megaphone',
    children: [
      {
        type: 'link',
        to: '/social/publisher',
        label: 'Publisher AIgent',
        icon: 'megaphone',
        permission: PERMISSIONS.SOCIAL_PUBLISHER_VIEW,
      },
      {
        type: 'link',
        to: '/social/performance',
        label: 'Performance AIgent',
        icon: 'chart',
        permission: PERMISSIONS.SOCIAL_PERFORMANCE_VIEW,
      },
      {
        type: 'group',
        id: 'social-analysis',
        label: 'Analysis Engine',
        icon: 'search',
        children: [
          {
            type: 'link',
            to: '/social/analysis/collection',
            label: 'Data Collection AIgent',
            icon: 'search',
            permission: PERMISSIONS.SOCIAL_ANALYSIS_VIEW,
          },
          {
            type: 'link',
            to: '/social/analysis/insight',
            label: 'Audience Insight Analysis AIgent',
            icon: 'search',
            permission: PERMISSIONS.SOCIAL_ANALYSIS_VIEW,
          },
        ],
      },
      {
        type: 'link',
        to: '/social/settings',
        label: 'Pengaturan',
        icon: 'settings',
        permission: PERMISSIONS.SOCIAL_SETTINGS_MANAGE,
      },
    ],
  },
  {
    type: 'group',
    id: 'system',
    label: 'Sistem',
    icon: 'system',
    children: [
      {
        type: 'link',
        to: '/users',
        label: 'Pengguna',
        icon: 'users',
        permission: PERMISSIONS.USERS_VIEW,
      },
      {
        type: 'link',
        to: '/roles',
        label: 'Role & Akses',
        icon: 'roles',
        permission: PERMISSIONS.ROLES_VIEW,
      },
    ],
  },
];

/** The links of entries, with (sub-)groups expanded. */
export function flattenNavLinks(entries: readonly NavEntry[]): NavLinkItem[] {
  return entries.flatMap((entry) =>
    entry.type === 'group' ? flattenNavLinks(entry.children) : [entry],
  );
}

/** All navigable pages, flattened (groups expanded). */
export const NAV_LINKS: readonly NavLinkItem[] = flattenNavLinks(NAV_ENTRIES);

function filterEntries(
  entries: readonly NavEntry[],
  can: (permission: Permission) => boolean,
): NavEntry[] {
  return entries.flatMap((entry): NavEntry[] => {
    if (entry.type === 'link') return can(entry.permission) ? [entry] : [];
    const children = filterEntries(entry.children, can);
    return children.length > 0 ? [{ ...entry, children }] : [];
  });
}

/** Entries filtered by permission; empty groups (and sub-groups) are dropped. */
export function visibleNavEntries(can: (permission: Permission) => boolean): NavEntry[] {
  return filterEntries(NAV_ENTRIES, can);
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
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\')
  ) {
    return null;
  }
  return value.startsWith('/login') ? null : value;
}

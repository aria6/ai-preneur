/**
 * Permission catalog — the single source of truth for what a role can grant.
 *
 * Permissions are defined in code (features are code), synced into the
 * `permissions` table by the seed script, and assigned to roles at runtime.
 * To add a feature permission: add it here, re-run `pnpm db:seed`, then guard
 * the API route with `requirePermission(...)` and the page with `<RequirePermission>`.
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',
  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',
  SOCIAL_PUBLISHER_VIEW: 'social.publisher.view',
  SOCIAL_PUBLISHER_MANAGE: 'social.publisher.manage',
  SOCIAL_SETTINGS_MANAGE: 'social.settings.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDefinition {
  key: Permission;
  /** UI grouping, e.g. "Pengguna". */
  category: string;
  label: string;
  description: string;
}

export const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  {
    key: PERMISSIONS.DASHBOARD_VIEW,
    category: 'Dashboard',
    label: 'Lihat dashboard',
    description: 'Mengakses halaman dashboard.',
  },
  {
    key: PERMISSIONS.USERS_VIEW,
    category: 'Pengguna',
    label: 'Lihat pengguna',
    description: 'Melihat daftar dan detail pengguna.',
  },
  {
    key: PERMISSIONS.USERS_CREATE,
    category: 'Pengguna',
    label: 'Tambah pengguna',
    description: 'Membuat akun pengguna baru.',
  },
  {
    key: PERMISSIONS.USERS_UPDATE,
    category: 'Pengguna',
    label: 'Ubah pengguna',
    description: 'Mengubah nama, role, status, dan mereset password pengguna.',
  },
  {
    key: PERMISSIONS.USERS_DELETE,
    category: 'Pengguna',
    label: 'Hapus pengguna',
    description: 'Menghapus akun pengguna secara permanen.',
  },
  {
    key: PERMISSIONS.ROLES_VIEW,
    category: 'Role & Akses',
    label: 'Lihat role',
    description: 'Melihat daftar role beserta hak aksesnya.',
  },
  {
    key: PERMISSIONS.ROLES_MANAGE,
    category: 'Role & Akses',
    label: 'Kelola role',
    description: 'Membuat, mengubah, dan menghapus role serta hak aksesnya.',
  },
  {
    key: PERMISSIONS.SOCIAL_PUBLISHER_VIEW,
    category: 'Social Media AIgency',
    label: 'Lihat Publisher AIgent',
    description: 'Melihat batch publikasi, antrean konten, dan status unggahan.',
  },
  {
    key: PERMISSIONS.SOCIAL_PUBLISHER_MANAGE,
    category: 'Social Media AIgency',
    label: 'Kelola Publisher AIgent',
    description:
      'Membuat batch, mengatur antrean dan jadwal, menghubungkan akun, dan mengonfirmasi jadwal.',
  },
  {
    key: PERMISSIONS.SOCIAL_SETTINGS_MANAGE,
    category: 'Social Media AIgency',
    label: 'Kelola pengaturan Social Media AIgency',
    description: 'Mengubah batas waktu kunci edit dan jeda minimal konfirmasi jadwal.',
  },
];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_DEFINITIONS.map((p) => p.key);

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

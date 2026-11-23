/**
 * Idempotent database seed — safe to run any number of times.
 *
 *   pnpm db:seed
 *
 * 1. Syncs the `permissions` table with the code catalog (@ai-preneur/shared).
 * 2. Ensures the system role "Super Admin" and a starter role "Member" exist.
 * 3. Creates the first Super Admin user if that email does not exist yet.
 *    Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_NAME / SEED_ADMIN_PASSWORD.
 *    Without SEED_ADMIN_PASSWORD a strong random password is generated and
 *    printed once. Existing users are never modified.
 */
import { randomBytes } from 'node:crypto';

import {
  createDatabaseClient,
  eq,
  notInArray,
  permissions,
  rolePermissions,
  roles,
  sql,
  users,
  type DatabaseExecutor,
} from '@ai-preneur/database';
import {
  ALL_PERMISSIONS,
  emailSchema,
  passwordSchema,
  PERMISSION_DEFINITIONS,
  PERMISSIONS,
  personNameSchema,
} from '@ai-preneur/shared';

import { loadConfig, loadEnvFile } from '../config/env.js';
import { hashPassword } from '../modules/iam/index.js';

const SUPER_ADMIN_ROLE = {
  name: 'Super Admin',
  description: 'Akses penuh ke seluruh fitur. Role sistem, tidak dapat diubah atau dihapus.',
};
const MEMBER_ROLE = {
  name: 'Member',
  description: 'Pengguna standar. Hanya dapat mengakses dashboard.',
  permissions: [PERMISSIONS.DASHBOARD_VIEW],
};

async function findRoleId(db: DatabaseExecutor, name: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(sql`lower(${roles.name}) = lower(${name})`)
    .limit(1);
  return row?.id;
}

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();

  const email = emailSchema.parse(process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com');
  const name = personNameSchema.parse(process.env.SEED_ADMIN_NAME ?? 'Super Admin');
  const providedPassword = process.env.SEED_ADMIN_PASSWORD?.trim();
  const password = providedPassword
    ? passwordSchema.parse(providedPassword)
    : randomBytes(18).toString('base64url');

  const database = createDatabaseClient({
    connectionString: config.database.url,
    maxConnections: 2,
  });

  try {
    const passwordHash = await hashPassword(password);

    const result = await database.db.transaction(async (tx) => {
      // 1. Permission catalog
      await tx
        .insert(permissions)
        .values(
          PERMISSION_DEFINITIONS.map((p) => ({
            key: p.key,
            category: p.category,
            description: p.description,
          })),
        )
        .onConflictDoUpdate({
          target: permissions.key,
          set: { category: sql`excluded.category`, description: sql`excluded.description` },
        });
      await tx.delete(permissions).where(notInArray(permissions.key, [...ALL_PERMISSIONS]));

      // 2. Roles
      let superAdminRoleId = await findRoleId(tx, SUPER_ADMIN_ROLE.name);
      if (superAdminRoleId) {
        await tx.update(roles).set({ isSystem: true }).where(eq(roles.id, superAdminRoleId));
      } else {
        const [row] = await tx
          .insert(roles)
          .values({ ...SUPER_ADMIN_ROLE, isSystem: true })
          .returning({ id: roles.id });
        superAdminRoleId = row?.id;
      }
      if (!superAdminRoleId) throw new Error('Could not create the Super Admin role');

      if (!(await findRoleId(tx, MEMBER_ROLE.name))) {
        const [row] = await tx
          .insert(roles)
          .values({ name: MEMBER_ROLE.name, description: MEMBER_ROLE.description })
          .returning({ id: roles.id });
        if (row) {
          await tx
            .insert(rolePermissions)
            .values(
              MEMBER_ROLE.permissions.map((permissionKey) => ({ roleId: row.id, permissionKey })),
            );
        }
      }

      // 3. First administrator
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing) return { adminCreated: false };

      await tx
        .insert(users)
        .values({ email, name, passwordHash, roleId: superAdminRoleId, isActive: true });
      return { adminCreated: true };
    });

    console.log(`✔ Permissions synced (${ALL_PERMISSIONS.length})`);
    console.log(`✔ Roles ensured: ${SUPER_ADMIN_ROLE.name}, ${MEMBER_ROLE.name}`);
    if (result.adminCreated) {
      console.log(`✔ Super Admin created: ${email}`);
      if (!providedPassword) {
        console.log(`  Generated password (shown only once): ${password}`);
        console.log('  Change it after the first login (Profil → Ubah password).');
      }
    } else {
      console.log(`• User ${email} already exists — left unchanged.`);
    }
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error('✖ Seed failed:', error);
  process.exitCode = 1;
});

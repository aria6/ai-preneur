/**
 * Identity & Access Management (IAM) tables.
 * Owner: apps/api/src/modules/iam — no other module may query these tables directly.
 *
 * Kept in a single file with no relative imports so Drizzle Kit can load it
 * standalone (see drizzle.config.ts → schema glob).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`);

// ---- Roles & permissions ---------------------------------------------------------

export const roles = pgTable(
  'roles',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 100 }).notNull(),
    description: varchar({ length: 500 }),
    /** System roles hold every permission implicitly and are immutable through the API. */
    isSystem: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roles_name_lower_unique').on(sql`lower(${t.name})`)],
);

/** Mirror of the code-defined catalog in @ai-preneur/shared, synced by the seed script. */
export const permissions = pgTable('permissions', {
  key: varchar({ length: 100 }).primaryKey(),
  category: varchar({ length: 100 }).notNull(),
  description: varchar({ length: 255 }).notNull(),
  createdAt: createdAt(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: varchar({ length: 100 })
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),
    index('role_permissions_permission_key_idx').on(t.permissionKey),
  ],
);

// ---- Users -----------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Always stored trimmed + lower-cased (enforced by a CHECK constraint). */
    email: varchar({ length: 254 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    /** scrypt hash in PHC-like format: scrypt$N$r$p$salt$hash */
    passwordHash: text().notNull(),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    isActive: boolean().notNull().default(true),
    /** Sessions created before this instant are rejected. */
    passwordChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    index('users_role_id_idx').on(t.roleId),
    check('users_email_normalized', sql`${t.email} = lower(btrim(${t.email}))`),
  ],
);

// ---- Sessions --------------------------------------------------------------------

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 (hex) of the opaque cookie token. The raw token is never stored. */
    tokenHash: varchar({ length: 64 }).notNull(),
    ipAddress: varchar({ length: 64 }),
    userAgent: varchar({ length: 512 }),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

// ---- Brute-force protection ------------------------------------------------------

/**
 * Failed-attempt counters keyed by hashed email, client IP or user id.
 * Keys never contain raw emails. Works for unknown emails too, so lockouts
 * do not reveal whether an account exists.
 */
export const loginThrottles = pgTable('login_throttles', {
  key: varchar({ length: 128 }).primaryKey(),
  attempts: integer().notNull().default(0),
  windowStartedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp({ withTimezone: true }),
  updatedAt: updatedAt(),
});

export type RoleRow = typeof roles.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

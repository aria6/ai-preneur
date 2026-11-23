/**
 * @ai-preneur/database — SERVER-ONLY.
 *
 * Owns the PostgreSQL connection, Drizzle schema and migrations.
 * Must never be imported by apps/web or packages/shared.
 */
export {
  createDatabaseClient,
  type Database,
  type DatabaseClient,
  type DatabaseClientOptions,
  type DatabaseExecutor,
  type DatabaseSchema,
} from './client.js';
export { isForeignKeyViolation, isUniqueViolation } from './errors.js';
export * from './schema/index.js';
export * as schema from './schema/index.js';

/**
 * Query operators re-exported so consumers use the exact drizzle-orm instance
 * that built the tables (and do not need their own drizzle-orm dependency).
 */
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  not,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
export type { SQL } from 'drizzle-orm';

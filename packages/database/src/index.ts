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
  type DatabaseSchema,
} from './client.js';
export * as schema from './schema/index.js';

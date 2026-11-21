import {
  drizzle,
  type NodePgDatabase,
  type NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import type { Pool } from 'pg';

import * as schema from './schema/index.js';

export type DatabaseSchema = typeof schema;
export type Database = NodePgDatabase<DatabaseSchema>;

/**
 * Anything that can run queries: the root `db` or a transaction `tx`.
 * Repositories accept this so they work inside and outside transactions.
 */
export type DatabaseExecutor = PgDatabase<NodePgQueryResultHKT, DatabaseSchema>;

export interface DatabaseClientOptions {
  /** PostgreSQL connection string (postgres:// or postgresql://). */
  connectionString: string;
  /** Maximum number of pooled connections. Defaults to 10. */
  maxConnections?: number;
  /** Milliseconds to wait for a connection before failing. Defaults to 5000. */
  connectionTimeoutMs?: number;
  /** Called when an idle pooled client errors (e.g. the server restarts). */
  onError?: (error: Error) => void;
}

export interface DatabaseClient {
  /** Drizzle query builder bound to the connection pool. */
  db: Database;
  /** Underlying pg pool. Prefer `db`; use the pool only for infrastructure concerns. */
  pool: Pool;
  /** Runs `select 1`. Resolves when the database is reachable. */
  ping(): Promise<void>;
  /** Drains the pool. Call once during graceful shutdown. */
  close(): Promise<void>;
}

/**
 * Creates a database client. Connections are opened lazily on first query,
 * so calling this never blocks startup and never runs migrations.
 *
 * The application should create exactly one client at its composition root
 * (apps/api/src/server.ts) and pass it explicitly to whatever needs it.
 */
export function createDatabaseClient(options: DatabaseClientOptions): DatabaseClient {
  if (!/^postgres(ql)?:\/\//.test(options.connectionString)) {
    throw new Error('connectionString must be a PostgreSQL URL (postgres:// or postgresql://).');
  }

  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
  });

  // Without a listener, an idle-client error would crash the process.
  pool.on('error', (error) => {
    options.onError?.(error);
  });

  const db = drizzle({ client: pool, schema, casing: 'snake_case' });

  return {
    db,
    pool,
    async ping() {
      await pool.query('select 1');
    },
    async close() {
      await pool.end();
    },
  };
}

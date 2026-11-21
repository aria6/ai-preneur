/**
 * Drizzle schema entry point used by the runtime client.
 * Drizzle Kit reads the `*.schema.ts` files directly (see drizzle.config.ts).
 *
 * Adding a table: create/extend `<module>.schema.ts`, re-export it here,
 * run `pnpm db:generate`, review + commit the SQL, run `pnpm db:migrate`.
 * See README.md in this directory for conventions.
 */
export * from './iam.schema.js';

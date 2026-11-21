/**
 * Drizzle schema entry point (read by drizzle.config.ts and by the client).
 *
 * No business tables exist yet. When adding one:
 *   1. Create `<module>.schema.ts` in this directory, named after the owning
 *      backend module (e.g. `users.schema.ts` for apps/api/src/modules/users).
 *   2. Re-export it here:  export * from './users.schema.js';
 *   3. Run `pnpm db:generate`, review the SQL in src/migrations, commit it.
 *   4. Apply it with `pnpm db:migrate`.
 *
 * See src/schema/README.md for naming conventions.
 */
export {};

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Drizzle Kit commands are run through pnpm from this package directory
// (`pnpm --filter @ai-preneur/database db:*`), so the repo-root `.env` is two levels up.
// Variables already present in the environment take precedence over the file.
loadDotenv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
  throw new Error('DATABASE_URL must be a PostgreSQL connection string (postgres:// or postgresql://).');
}

export default defineConfig({
  dialect: 'postgresql',
  // Glob over table files (not index.ts) so Drizzle Kit never has to resolve
  // NodeNext-style `.js` re-exports.
  schema: './src/schema/*.schema.ts',
  out: './src/migrations',
  // `generate` and `check` work offline; `migrate` and `studio` require DATABASE_URL.
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});

# Schema conventions

- **PostgreSQL only.** Import column builders from `drizzle-orm/pg-core`.
- **One file per owning backend module:** `users.schema.ts`, `workflows.schema.ts`, …
  A table belongs to exactly one module. Other modules must not query it directly —
  they call the owning module's service instead.
- **Naming:** TypeScript keys in camelCase; the client and Drizzle Kit use
  `casing: 'snake_case'`, so `createdAt` becomes the `created_at` column automatically.
  Table names are plural snake_case (`workflow_executions`).
- **Primary keys:** prefer `uuid('id').primaryKey().defaultRandom()`.
- **Timestamps:** `timestamp({ withTimezone: true }).notNull().defaultNow()`.
- **Every file is re-exported** from `index.ts`, otherwise Drizzle Kit will not see it.
- **Migrations are generated, reviewed and committed** (`pnpm db:generate`), then applied
  explicitly (`pnpm db:migrate`). The API never migrates on startup.
- Avoid `drizzle-kit push` outside throwaway local databases — it bypasses migration history.

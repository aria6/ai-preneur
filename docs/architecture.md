# Architecture

AI Preneur is a **modular monolith**: one deployable backend, one frontend, one PostgreSQL
database, organised internally into independently maintainable modules with explicit,
enforced boundaries.

```text
┌──────────────┐   HTTP + JSON envelope   ┌──────────────────────────────────────┐
│  apps/web    │ ───────────────────────▶ │  apps/api  (Express)                 │
│  React SPA   │                          │  routes/ → modules/<name>/ → core/   │
└──────┬───────┘                          └───────────┬───────────────┬──────────┘
       │ contracts                                     │ contracts     │ data access
       ▼                                               ▼               ▼
┌─────────────────────────┐                ┌─────────────────────────────────────┐
│  packages/shared        │◀───────────────│  packages/database  (server-only)   │
│  types, constants, Zod  │   (not today)  │  Drizzle client, schema, migrations │
└─────────────────────────┘                └──────────────────┬──────────────────┘
                                                              ▼
                                                        PostgreSQL
```

## 1. Modular monolith principles

1. **One logical system, one process.** All modules run in the same Express process and
   share one connection pool. No network hops between modules, no distributed transactions.
2. **Modules are the unit of ownership.** A module owns its routes, logic, data access and
   tables. Nothing outside a module reaches into its internals.
3. **Communication through public APIs.** A module exposes what others may use via its
   `index.ts`. Cross-module calls are plain function calls on that public API.
4. **Explicit dependencies.** Long-lived resources (config, logger, database client) are
   created once in `apps/api/src/server.ts` — the composition root — and passed down as
   arguments. There is no service locator, DI container or module-level singleton.
5. **Simplicity first.** Layers, abstractions and packages are added when there is a
   concrete need, not in anticipation of one.

## 2. Frontend / backend separation

- `apps/web` and `apps/api` are separate workspace packages with separate builds and can be
  started, deployed and scaled independently.
- The **only** coupling is the HTTP API and the contracts in `@ai-preneur/shared`.
- The web app reaches the API through a single configurable base URL
  (`VITE_API_BASE_URL`) and a single HTTP client (`apps/web/src/services/api-client.ts`).
  Components and hooks never call `fetch` directly; they go through a service in
  `src/services/`.
- Every API response uses the same envelope (defined in `@ai-preneur/shared`):

  ```jsonc
  { "success": true,  "data": { /* ... */ } }
  { "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ /* ValidationIssue */ ] } }
  ```

  Clients branch on `error.code` (see `ERROR_CODES`), never on `message`.

### Frontend layout

| Folder                   | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `src/app/`               | App shell: router, root component, global styles, env access        |
| `src/pages/`             | Route-level components, one per route                               |
| `src/components/`        | Reusable presentational components (`layout/` for shells)           |
| `src/hooks/`             | Reusable React hooks                                                |
| `src/services/`          | API client and per-feature API services                             |
| `src/types/`             | Frontend-only ambient/global types (e.g. `ImportMetaEnv`)           |

When features arrive and these flat folders grow, group by feature
(`src/features/<name>/{components,hooks,services}`) rather than adding more global folders.

## 3. Backend module boundaries

```text
apps/api/src/
├── server.ts        composition root: env → config → logger → db client → app → listen; shutdown
├── app.ts           createApp(deps): middleware pipeline, mounts routes, 404, error handler
├── config/          env loading + Zod validation → typed AppConfig
├── core/            cross-cutting building blocks: errors, logger, response helpers, validation
├── middlewares/     Express middleware: request logging, 404, central error handler
├── routes/          createApiRouter(deps): the single place modules are mounted on paths
└── modules/
    └── <name>/      one directory per business capability
```

**Allowed import direction** (enforced by `pnpm check:boundaries`):

```text
server.ts → app.ts → routes/ → modules/<name>/index.ts → module internals → core/, config/ types
                     middlewares/ → core/
```

- `core/` and `config/` never import `modules/`, `routes/`, `middlewares/`, `app` or `server`.
- A module never imports `app`, `server` or `routes/`.
- Module A imports module B **only** via `modules/B/index.ts`.
- Cycles between modules are not allowed. If A and B need each other, extract the shared
  concept into a third module, or invert the dependency by passing a function in.

### Module anatomy and when to introduce each layer

Only `index.ts` and `<name>.routes.ts` are required. Everything else is added when it earns
its place — empty layers are not created.

| File                     | Introduce it when…                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `index.ts`               | Always. Exports the router factory and anything other modules may use.                               |
| `<name>.routes.ts`       | Always. `create<Name>Router(deps)` — paths, HTTP verbs, wiring.                                       |
| `<name>.controller.ts`   | Handlers grow beyond a few lines of parse → call service → respond, or are numerous.                 |
| `<name>.service.ts`      | There is business logic: rules, orchestration, calls to other modules, transactions.                |
| `<name>.repository.ts`   | The module touches the database. All Drizzle queries for the module's tables live here.              |
| `<name>.schemas.ts`      | The module validates input with Zod schemas that the frontend does not need.                         |
| `<name>.types.ts`        | Module-private types are reused across several files of the module.                                  |

Request flow inside a module: **routes → controller → service → repository → database**.
Controllers parse input (`parseInput(schema, req.body)`), call services and respond
(`sendSuccess`). Services contain logic and never touch `req`/`res`. Repositories contain
queries and no logic. Errors are thrown as `AppError` and rendered by the central handler.

`modules/health/` is the reference implementation: routes + service, no controller or
repository because it doesn't need them.

## 4. Database package responsibilities (`@ai-preneur/database`)

- **Server-only.** Never imported by `apps/web` or `packages/shared`.
- Exposes `createDatabaseClient({ connectionString, ... })`, returning `{ db, pool, ping, close }`.
  It does not read environment variables itself — the API passes the URL explicitly; only
  `drizzle.config.ts` (a CLI concern) reads `.env`.
- Owns the Drizzle schema (`src/schema/`) and the SQL migrations (`src/migrations/`).
- **PostgreSQL only** (`dialect: 'postgresql'`, `node-postgres` driver).
- Connections are lazy: creating the client never blocks startup.
- **Migrations never run automatically.** They are generated (`pnpm db:generate`),
  reviewed and committed, then applied explicitly (`pnpm db:migrate`). Drizzle stores
  applied migrations in `drizzle.__drizzle_migrations`.
- Schema conventions are in `packages/database/src/schema/README.md`: one
  `<module>.schema.ts` file per owning backend module, camelCase keys mapped to snake_case
  columns.

Table ownership mirrors module ownership: only the `users` module's repository queries
`users.schema.ts` tables. Other modules call the `users` service.

## 5. Shared package responsibilities (`@ai-preneur/shared`)

Contains only what **both** the browser and the server genuinely need:

- API contracts as Zod schemas (`healthResponseSchema`) and their inferred types.
- Response envelope types (`ApiResponse`, `ApiErrorBody`, `ValidationIssue`).
- Constants (`API_PREFIX`, `ERROR_CODES`).

Must **not** contain business logic, database code, Node.js built-ins, browser APIs, or any
dependency other than `zod`. If only one side needs something, it stays on that side.

## 6. Dependency rules

| Package              | May depend on (internal)                    | Must never import                                  |
| -------------------- | ------------------------------------------- | -------------------------------------------------- |
| `apps/web`           | `@ai-preneur/shared`                        | `@ai-preneur/api`, `@ai-preneur/database`, express, pg, drizzle-orm, dotenv, `node:*` |
| `apps/api`           | `@ai-preneur/shared`, `@ai-preneur/database` | `@ai-preneur/web`                                  |
| `packages/database`  | —                                           | any app                                            |
| `packages/shared`    | — (external: `zod` only)                    | any workspace package, `node:*`                    |

Additional rules: no relative imports across package boundaries, no deep imports
(`@ai-preneur/shared/src/...`), acyclic package graph.

**Enforcement, in three layers:**

1. **pnpm's strict `node_modules`** — a package can only resolve dependencies it declares,
   so `apps/web` physically cannot resolve `@ai-preneur/database`.
2. **`scripts/check-boundaries.mjs`** (`pnpm check:boundaries`, also part of `pnpm lint`) —
   dependency-free checker for all the rules above plus API module isolation.
3. **OXLint** `no-restricted-imports` and `import/no-cycle` for editor feedback.

### How workspace packages resolve (no path aliases)

Internal packages are real npm-style packages with an `exports` map:

```json
".": { "development": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }
```

- **Development** (`tsx --conditions=development`, Vite dev server, `tsc` type-checking via
  `customConditions: ["development"]`): resolves straight to TypeScript source — no build
  step or watcher needed for shared/database while developing.
- **Production** (`node dist/server.js`, `vite build`, `tsconfig.build.json` with
  `customConditions: []`): resolves to compiled `dist/`. `pnpm build` builds packages in
  topological order.

Relative imports in Node-targeted packages use the `.js` extension (NodeNext ESM rules), so
compiled output runs on plain Node with no loader, bundler or alias rewriting.

## 7. Adding a new backend module

1. Create `apps/api/src/modules/<name>/` with `index.ts` and `<name>.routes.ts`
   exporting `create<Name>Router(deps)`. Declare exactly the deps it needs
   (e.g. `{ db: Database; logger: Logger }`).
2. Mount it in `apps/api/src/routes/index.ts`:
   `router.use('/<name>', create<Name>Router({ db: deps.database.db, logger: deps.logger }))`.
3. If it stores data: add `packages/database/src/schema/<name>.schema.ts`, re-export it from
   `schema/index.ts`, run `pnpm db:generate`, review and commit the SQL, run `pnpm db:migrate`.
   Put queries in `<name>.repository.ts`.
4. If the frontend consumes it: put request/response Zod schemas in
   `packages/shared/src/schemas/<name>.ts`, export them from `schemas/index.ts`, and add a
   `apps/web/src/services/<name>.service.ts` that calls `apiClient` with the schema.
5. Add controller/service/schemas/types files only as the table in §3 says they're needed.
6. Run `pnpm verify`.

## 8. Evolving into separate services

The boundaries above are what make extraction possible without a rewrite. To extract
module `X` into its own service:

1. **Code:** `modules/X/` already has a single public API (`index.ts`) and receives its
   dependencies as arguments. Move it into `apps/x-service/` with its own `server.ts`
   composition root that reuses the same `createApp` pattern.
2. **Data:** `X` already owns its tables exclusively, so move `X.schema.ts` and its
   migrations to a dedicated database (or schema) without untangling foreign queries.
3. **Callers:** other modules already call `X` only through `modules/X/index.ts`. Replace
   that implementation with an HTTP (or message) client exposing the same function
   signatures; callers do not change.
4. **Contracts:** request/response schemas already live in `@ai-preneur/shared`, so both
   sides keep validating against the same definitions.
5. **Frontend:** it already talks to the API through one base URL; route `/api/x/*` to the
   new service at the gateway/reverse-proxy level.

What to keep avoiding until extraction is actually needed: cross-module database joins,
cross-module transactions, and importing another module's internals — each one is a seam
that would have to be cut later.

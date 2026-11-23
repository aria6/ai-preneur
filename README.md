# AI Preneur

Platform foundation for AI Preneur — one platform hosting many lines of work (social media,
business development, software house, IoT, digital marketing, education, digital content,
food estate, …).

> **Status:** foundation, **authentication & user management** (login/logout, role-based
> access control, profile) and **Social Media AIgency → Publisher AIgent, Tahap 1** (content queue
> from Google Drive, scheduling, accounts; the upload engine comes in Tahap 2).
> See [`docs/architecture.md`](docs/architecture.md), [`docs/auth-and-access.md`](docs/auth-and-access.md)
> and [`docs/social-media-aigency.md`](docs/social-media-aigency.md).

## Quick start

```bash
corepack enable && pnpm install
cp .env.example .env     # set DATABASE_URL (and SEED_ADMIN_* if you like)
createdb ai_preneur      # or create the database with your preferred tool
pnpm db:setup            # generate migrations → apply → seed roles + first Super Admin
pnpm dev                 # http://localhost:5173 — log in with the seeded admin
```

## Technology stack

| Area           | Tools                                                             |
| -------------- | ----------------------------------------------------------------- |
| Frontend       | React 19, Vite 7, TypeScript, React Router 7, Tailwind CSS 4      |
| Backend        | Node.js 22, Express 5, TypeScript, Zod 4                          |
| Database       | PostgreSQL, Drizzle ORM, Drizzle Kit                              |
| Infrastructure | pnpm workspaces (monorepo), OXLint, Prettier, dotenv              |

## Architecture overview

A **modular monolith**: one API process, one frontend, one PostgreSQL database, with
business capabilities organised as isolated modules that talk only through public APIs.

```text
apps/
  web/          React SPA (Vite). Talks to the API over HTTP only.
  api/          Express API. Composition root in server.ts; modules in src/modules/<name>/.
packages/
  shared/       Runtime-agnostic API contracts: Zod schemas, types, constants. Used by both apps.
  database/     Server-only: Drizzle client factory, schema, migrations.
docs/
  architecture.md, auth-and-access.md
scripts/
  check-boundaries.mjs   Enforces architectural dependency rules.
```

Dependency direction: `web → shared`, `api → shared + database`. The web app can never
import server code — enforced by pnpm, `pnpm check:boundaries` and OXLint. Full details,
module conventions and the extraction path to services: [`docs/architecture.md`](docs/architecture.md).

### Project structure

```text
.
├── apps/
│   ├── web/
│   │   ├── public/favicon.svg
│   │   ├── src/
│   │   │   ├── app/          App.tsx, router.tsx, env.ts, styles.css, auth/ (AuthProvider)
│   │   │   ├── components/   auth/ (route guards), layout/ (AppLayout, Sidebar, SidebarProfile), ui/
│   │   │   ├── hooks/        use-auth, use-media-query, use-debounced-value
│   │   │   ├── lib/          navigation (menu), access, errors, format, cn
│   │   │   ├── pages/        Login, Dashboard, Profile, users/, roles/, social/, Forbidden, NotFound
│   │   │   ├── services/     api-client.ts, auth/users/roles services
│   │   │   ├── types/        vite-env.d.ts
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   └── api/
│       ├── src/
│       │   ├── config/       env.ts
│       │   ├── core/         dependencies.ts, errors.ts, http.ts, logger.ts, validation.ts
│       │   ├── middlewares/  error-handler, not-found, request-logger, security-headers, origin-check
│       │   ├── modules/      health/ (reference), iam/ (auth, users, roles), social-media/ (Publisher AIgent), README.md
│       │   ├── scripts/      seed.ts
│       │   ├── routes/       index.ts
│       │   ├── app.ts
│       │   └── server.ts
│       ├── tsconfig.json         (type-check, dev)
│       └── tsconfig.build.json   (emit to dist/)
├── packages/
│   ├── database/
│   │   ├── src/
│   │   │   ├── schema/       iam.schema.ts, social-media.schema.ts (sm_*), index.ts
│   │   │   ├── migrations/   generated SQL (committed)
│   │   │   ├── client.ts
│   │   │   └── index.ts
│   │   └── drizzle.config.ts
│   └── shared/
│       └── src/{constants,schemas,types}/, index.ts
├── docs/architecture.md, docs/auth-and-access.md
├── scripts/check-boundaries.mjs
├── .env.example  .gitignore  .prettierrc  .prettierignore  .oxlintrc.json  .nvmrc
├── package.json  pnpm-workspace.yaml  tsconfig.base.json
└── README.md
```

## Prerequisites

- **Node.js ≥ 22.12** (see `.nvmrc`)
- **pnpm ≥ 10** — `corepack enable` picks up the version pinned in `package.json`
- **PostgreSQL ≥ 14**, reachable from your machine (local install or managed instance)

## Installation

```bash
git clone https://github.com/aria6/ai-preneur.git
cd ai-preneur
corepack enable
pnpm install
cp .env.example .env        # then edit DATABASE_URL etc.
createdb ai_preneur         # or create the database with your preferred tool
```

## Environment configuration

A **single `.env` at the repository root** is read by the API (`dotenv`), by Drizzle Kit
and by Vite (`envDir: '../..'`). Real environment variables always override the file.

| Variable              | Used by      | Default                    | Notes                                         |
| --------------------- | ------------ | -------------------------- | --------------------------------------------- |
| `NODE_ENV`            | api          | `development`              | `development` \| `test` \| `production`       |
| `API_HOST`            | api          | `localhost`                | Use `0.0.0.0` in containers/servers           |
| `API_PORT`            | api          | `3000`                     |                                               |
| `CORS_ORIGIN`         | api          | `http://localhost:5173`    | Comma-separated list of allowed origins       |
| `LOG_LEVEL`           | api          | `info`                     | `debug` \| `info` \| `warn` \| `error`        |
| `SHUTDOWN_TIMEOUT_MS` | api          | `10000`                    | Grace period before forced exit               |
| `TRUST_PROXY`         | api          | `false`                    | Proxy hop count behind a reverse proxy (correct client IP) |
| `SESSION_TTL_HOURS`   | api          | `168`                      | Absolute session lifetime                     |
| `SESSION_IDLE_TIMEOUT_MINUTES` | api | `1440`                     | Inactivity timeout                            |
| `SESSION_COOKIE_SECURE` | api        | `true` in production       | HTTPS-only `__Host-` cookie                   |
| `DATABASE_URL`        | api, drizzle | — (**required**)           | `postgres://` or `postgresql://` only         |
| `DATABASE_POOL_MAX`   | api          | `10`                       |                                               |
| `GOOGLE_API_KEY`      | api          | —                          | Reads public Drive folders (Publisher AIgent) |
| `SOCIAL_CREDENTIALS_KEY` | api       | —                          | `openssl rand -base64 32`; encrypts social tokens |
| `SOCIAL_PUBLISHER_ENABLED` | api     | `false`                    | Scheduled-upload worker (Tahap 2)             |
| `SEED_ADMIN_EMAIL`    | seed         | `admin@example.com`        | First Super Admin                             |
| `SEED_ADMIN_NAME`     | seed         | `Super Admin`              |                                               |
| `SEED_ADMIN_PASSWORD` | seed         | random (printed once)      | Min 8 chars                                   |
| `VITE_API_BASE_URL`   | web          | — (**required**)           | `/api` (same origin). Public — never put secrets in `VITE_*` |
| `API_PROXY_TARGET`    | web (dev)    | `http://localhost:3000`    | Where the Vite dev server proxies `/api`      |

The API validates its environment with Zod at startup and exits with a readable list of
problems if anything is missing or malformed.

## Development

```bash
pnpm dev          # web (http://localhost:5173, proxies /api) + api (http://localhost:3000) together
pnpm dev:web      # frontend only
pnpm dev:api      # backend only (tsx watch)
```

In development, `@ai-preneur/shared` and `@ai-preneur/database` are consumed directly from
TypeScript source — no separate build or watcher needed.

Health check:

```bash
curl http://localhost:3000/api/health
# {"success":true,"data":{"status":"ok","timestamp":"…","uptimeSeconds":3,"checks":{"database":"up"}}}
# HTTP 503 with "status":"degraded" when the database is unreachable.
```

### Quality commands

```bash
pnpm typecheck         # tsc --noEmit in every workspace
pnpm lint              # OXLint + architectural boundary check
pnpm lint:fix          # OXLint autofix
pnpm check:boundaries  # boundary check only (works without node_modules)
pnpm format            # Prettier write
pnpm format:check      # Prettier check
pnpm verify            # format:check + lint + typecheck + build
```

## Build

```bash
pnpm build        # all packages, in dependency order (shared → database → api, web)
pnpm build:api    # api and its workspace dependencies
pnpm build:web    # web and its workspace dependencies
pnpm start:api    # run the compiled API: node dist/server.js
pnpm preview:web  # serve the built frontend locally
```

The web build output (`apps/web/dist`) is static files deployable to any static host;
`VITE_API_BASE_URL` is baked in at build time.

## Database migrations & seed

Migrations are **never** applied automatically on API startup.

```bash
pnpm db:setup      # = db:generate + db:migrate + db:seed (idempotent, safe to re-run)
pnpm db:seed       # sync permission catalog, ensure roles, create first Super Admin
pnpm db:generate   # diff src/schema → new SQL file in packages/database/src/migrations (no DB needed)
pnpm db:migrate    # apply pending migrations to DATABASE_URL
pnpm db:check      # check migration files for consistency
pnpm db:studio     # open Drizzle Studio against DATABASE_URL
```

Workflow: edit/add a `*.schema.ts` file → `pnpm db:generate` → review the SQL → commit →
`pnpm db:migrate`. See `packages/database/src/schema/README.md` for conventions.

**First run:** the IAM schema is defined in code but its first migration has not been generated
yet. `pnpm db:setup` (or `pnpm db:generate`) creates `0000_*.sql` under
`packages/database/src/migrations/` — **commit that folder** so every environment applies the same
migration history.

The seed creates the system role **Super Admin** (all permissions), a starter role **Member**
(`dashboard.view`) and the first Super Admin user from `SEED_ADMIN_*`. Re-running it never
modifies existing users. In production run the compiled seed: `pnpm --filter @ai-preneur/api db:seed:prod`.

## Authentication & access control

Session-cookie authentication with role-based access control. Every user has one role; a role is
a set of permissions that decides which pages and API endpoints the user can use. Manage them in
the app under **Pengguna** and **Role & Akses**. Security model, API reference and how to add
permissions for new features: [`docs/auth-and-access.md`](docs/auth-and-access.md).

## License

Private — all rights reserved.

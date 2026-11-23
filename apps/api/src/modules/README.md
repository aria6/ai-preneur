# Backend modules

Each business capability lives in its own directory here (`users/`, `agents/`,
`workflows/`, `executions/`, …). Existing: `health/` (infrastructure), `iam/`
(authentication, users, roles & permissions — see docs/auth-and-access.md) and `social-media/`
(Publisher AIgent — see docs/social-media-aigency.md).

Protect new routes with `requireAuth` / `requirePermission(PERMISSIONS.X)` from `../iam/index.js`.

## Conventions

```text
modules/<name>/
├── index.ts               # REQUIRED — the module's public API (router factory, service types)
├── <name>.routes.ts       # REQUIRED — create<Name>Router(deps): Router
├── <name>.controller.ts   # when handlers outgrow the routes file
├── <name>.service.ts      # when there is business logic beyond request/response mapping
├── <name>.repository.ts   # when the module reads/writes the database
├── <name>.schemas.ts      # module-private Zod schemas (public API contracts go to @ai-preneur/shared)
└── <name>.types.ts        # module-private types, once they no longer fit next to their usage
```

Do not create empty layers. Add a file only when it has a real job — see
`docs/architecture.md` → "When to introduce each layer".

## Rules (enforced by `pnpm check:boundaries`)

- Another module is imported **only through its `index.ts`**.
- Modules never import `app.ts`, `server.ts` or `routes/`.
- A module receives its dependencies as arguments to its router factory.
- A module owns its tables; other modules go through its service, never its repository.

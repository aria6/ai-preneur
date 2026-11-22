# Authentication, users & access control

Implemented by the `iam` module (`apps/api/src/modules/iam`) and the
`iam.schema.ts` tables in `@ai-preneur/database`.

## Concepts

- **User** — an account (email + password) with exactly **one role**. Can be active or deactivated.
- **Role** — a named set of permissions. Assigning a role to a user decides which features they can use.
- **Permission** — one capability, defined in code in
  `packages/shared/src/constants/permissions.ts` (e.g. `users.view`, `roles.manage`).
  The seed script mirrors the catalog into the `permissions` table.
- **System role** (`roles.is_system = true`, seeded as **Super Admin**) — implicitly holds
  every permission, including ones added later. It cannot be edited or deleted through the API.

| Permission       | Grants                                                          |
| ---------------- | --------------------------------------------------------------- |
| `dashboard.view` | Dashboard page                                                   |
| `users.view`     | User list and details                                            |
| `users.create`   | Create users                                                     |
| `users.update`   | Change name/role/status of users, reset their password          |
| `users.delete`   | Delete users                                                     |
| `roles.view`     | Role list with permissions                                       |
| `roles.manage`   | Create, edit and delete roles                                    |

Every logged-in user can always view their profile, change their name and change their password.

### Adding a permission for a new feature

1. Add it to `PERMISSIONS` and `PERMISSION_DEFINITIONS` in `@ai-preneur/shared`.
2. Run `pnpm db:seed` (syncs the `permissions` table).
3. Guard the API: `router.get('/', requirePermission(PERMISSIONS.X), handler)` (import from `modules/iam/index.ts`).
4. Guard the page with `<RequirePermission permission={PERMISSIONS.X}>` and add the menu entry to
   `apps/web/src/lib/navigation.ts`.
5. Grant it to roles from the **Role & Akses** page.

## API

All routes are under `/api`. Responses use the standard envelope.

| Method & path                 | Access                                   | Notes                                            |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `POST /auth/login`            | public                                   | Sets the session cookie, returns `{ user }`      |
| `POST /auth/logout`           | any                                      | Revokes the session, clears the cookie           |
| `GET /auth/me`                | authenticated                            | `{ user }` with effective permissions            |
| `PATCH /profile`              | authenticated                            | `{ name }`                                       |
| `PUT /profile/password`       | authenticated                            | `{ currentPassword, newPassword }`               |
| `GET /users`                  | `users.view`                             | `?page&pageSize&search`                          |
| `GET /users/:id`              | `users.view`                             |                                                  |
| `POST /users`                 | `users.create`                           |                                                  |
| `PATCH /users/:id`            | `users.update`                           | `{ name?, roleId?, isActive? }`                  |
| `PUT /users/:id/password`     | `users.update`                           | `{ newPassword }` — admin reset                  |
| `DELETE /users/:id`           | `users.delete`                           |                                                  |
| `GET /roles`                  | `roles.view` or `users.create/update`    | Role picker for user forms                       |
| `GET /roles/:id`              | `roles.view`                             |                                                  |
| `POST /roles`                 | `roles.manage`                           | `{ name, description?, permissions[] }`          |
| `PATCH /roles/:id`            | `roles.manage`                           |                                                  |
| `DELETE /roles/:id`           | `roles.manage`                           | Refused while users still hold the role          |

## Security model

### Sessions

- **Server-side sessions** in PostgreSQL, not JWTs: logout, deactivation and password changes take
  effect immediately.
- The cookie holds a 256-bit random token; the database stores only its **SHA-256**. A database leak
  does not yield usable sessions.
- Cookie flags: `HttpOnly` (unreadable from JavaScript → not stealable through XSS), `SameSite=Strict`,
  `Path=/`, `Secure` + `__Host-` prefix in production.
- Absolute lifetime (`SESSION_TTL_HOURS`, default 7 days) **and** idle timeout
  (`SESSION_IDLE_TIMEOUT_MINUTES`, default 24 h), both evaluated with the database clock.
- A new token is issued on every login (no session fixation). Logging in with an existing session
  revokes the old one.
- Every request re-reads the user, role and permissions, so role/permission changes apply at once
  and deactivated users lose access on their next request.
- Changing your password revokes **all** sessions and issues a fresh one for the current device;
  an admin password reset or deactivation revokes all of that user's sessions. Additionally, any
  session created before `users.password_changed_at` is rejected.

### Passwords

- **scrypt** (Node built-in, memory-hard; N=2¹⁵, r=8, p=1, 16-byte salt, 64-byte key), parameters
  stored with the hash and transparently upgraded on login (`needsRehash`).
- Constant-time comparison; Unicode NFKC normalization.
- Policy: 8–128 characters (NIST 800-63B — length over composition rules). The upper bound also caps
  hashing cost per request.
- Changing your own password requires the current password.

### Brute-force & enumeration

- Failed logins are counted **in PostgreSQL** (`login_throttles`) per hashed email (5 / 15 min) and per
  IP (50 / 15 min); a locked key gets `429` with `Retry-After`. Counting also happens for unknown
  emails, so a lockout never reveals whether an account exists.
- Wrong "current password" on password change: 5 / 15 min per user.
- Unknown emails still pay the full hashing cost, and every credential failure returns the same
  message → neither the response nor its timing reveals registered emails.
- A **per-IP burst limiter** (15 / min, `middlewares/rate-limit.ts`) sits in front of `/auth/login`
  and `/profile/password` and rejects with `429` **before** the password hash runs, so a burst cannot
  slip through the pre-hash gap in the DB throttle.
- **Concurrent scrypt calls are capped** (`security/password.ts`): each hash holds ~32 MiB, so
  unbounded parallel logins could OOM a small host. Excess calls queue instead of allocating at once.
- Per-IP limits key **IPv6 by /64** (one subscriber's whole allocation) and treat IPv4-mapped
  addresses as IPv4, so rotating addresses cannot evade them (`core/client-ip.ts`).
- Behind a reverse proxy set `TRUST_PROXY` so the real client IP is used. The burst limiter and scrypt
  cap are **in-memory / per-instance** (right for a single-instance deployment); for several instances
  or a hard DoS control, also rate-limit at the reverse proxy.

### Authorization (no privilege escalation)

Enforced server-side in `access-policy.ts`; the UI only mirrors it:

- You can only **grant permissions you hold** (creating or editing roles).
- You can only **assign a role** whose permissions you all hold; only system-role users can assign a
  system role.
- You can only **manage a user** (edit, reset password, deactivate, delete) whose current role you
  could assign — a user admin cannot reset a Super Admin's password.
- You cannot edit or delete **your own role**, and you cannot manage **your own account** through the
  admin endpoints (use `/profile`) → no self-escalation, no self-lockout.
- System roles are immutable; at least one active system-role user always remains — the
  "last active system user" check runs under a transaction-scoped Postgres advisory lock
  (`pg_advisory_xact_lock`), so two concurrent demotions/deletions can't both pass it and leave
  zero admins.

### Request hardening

- **CSRF:** `SameSite=Strict` cookie **plus** an Origin check on every state-changing request
  (`middlewares/origin-check.ts`): the `Origin`/`Referer` must be in `CORS_ORIGIN` or the API's own
  origin; requests with a session cookie but no origin are refused.
- **Input:** every body/query/param is validated with Zod; unknown fields are stripped (no mass
  assignment); IDs must be UUIDs; LIKE wildcards in search are escaped; all SQL is parameterized by
  Drizzle.
- **Output:** DTOs are mapped field by field — password hashes and token hashes can never be serialized.
- **Headers:** CSP `default-src 'none'`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store`, HSTS when the cookie is `Secure`. `x-powered-by` disabled.
- JSON body limit 100 kB. Errors never expose stack traces or internal messages.
- Security-relevant events (login failures, password changes, user/role mutations with actor id)
  are logged; secrets never are.

### Frontend

- The session token is never visible to JavaScript; the SPA learns who is logged in via `GET /auth/me`.
- Post-login redirects only follow same-app relative paths (no open redirect).
- Route guards and hidden buttons are UX only — every rule is enforced by the API.

### Deployment notes

- Serve the web app and the API from the **same site** (e.g. `app.example.com` + `/api` reverse-proxied,
  or `app.example.com` + `api.example.com`) over HTTPS. `SameSite=Strict` cookies are not sent
  cross-site.
- Set `NODE_ENV=production` (secure `__Host-` cookie, HSTS), the exact `CORS_ORIGIN`, and
  `TRUST_PROXY` matching your proxy hops.
- Change the seeded admin password after the first login.

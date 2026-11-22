# Security audit — IAM (auth, users, roles)

Date: 2026-11-23 · Scope: `apps/api` (authentication, authorization, users, roles),
`packages/shared` contracts, `packages/database` IAM schema. Target: the live
single-instance VPS deployment behind an SSH tunnel.

## Method

- **Whitebox:** full read of every auth/session/authorization path — cookie handling,
  session lifecycle, password hashing, the brute-force throttle, the RBAC policy
  (`access-policy.ts`) and all four route groups, checking each OWASP Top-10 class.
- **Blackbox (reasoned):** traced the attacker's view with no credentials — login
  brute force, user enumeration (response body + timing), CSRF, session theft/fixation,
  IDOR on `/users/:id` and `/roles/:id`, privilege escalation through role/user edits,
  and resource-exhaustion against the login endpoint. The app could not be hit over the
  network from the audit environment, so this is derived from the code rather than a
  live scan.

## Findings & fixes

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Medium | **Pre-auth DoS / brute-force burst.** `/auth/login` runs a ~32 MiB scrypt per request before any durable gate. The DB throttle only checks a lock that is written *after* failures, so a burst of concurrent requests from one IP all passed the gate and hashed in parallel (memory/CPU exhaustion), and ~50 guesses could land before the IP lock tripped. | **Fixed** — per-IP burst limiter (15/min) in front of the hash; concurrent scrypt capped at 4. |
| 2 | Low–Medium | **TOCTOU race in the "last active system user" guard.** Two concurrent demotions/deletions of the last two Super Admins could each read count=1 and both commit → zero admins (total lockout). | **Fixed** — guard runs under `pg_advisory_xact_lock` inside the transaction. |
| 3 | Medium | **IPv6 rotation bypasses every per-IP limit** *(found in the re-audit)*. The burst limiter and the DB IP throttle keyed on the full `req.ip`. One IPv6 subscriber usually controls a whole /64 (2⁶⁴ addresses), so an attacker could use a fresh address per attempt and never reach 15/min or 50/15 min. IPv4-mapped addresses (`::ffff:1.2.3.4`) were also bucketed apart from plain IPv4. | **Fixed** — `core/client-ip.ts` keys IPv6 by /64 and collapses IPv4-mapped to IPv4; used by both limiters. |

### Checked and found sound (no change needed)

- **Sessions:** server-side, opaque 256-bit token, only its SHA-256 stored; `HttpOnly` +
  `SameSite=Strict` + `__Host-`/`Secure` in production; fresh token per login (no fixation);
  absolute + idle expiry on the DB clock; every request re-reads role/permissions;
  password change and deactivation revoke all sessions; pre-password-change sessions rejected.
- **Passwords:** scrypt (memory-hard), constant-time compare, NFKC, transparent rehash.
- **Authorization:** no privilege-escalation path found. Every grant/assign/manage action is
  bounded by the actor's own permission set, transitively; system roles and more-powerful roles
  are unreachable; self-role and self-account admin actions are blocked. IDOR on `GET /users/:id`
  and `/roles/:id` is by design (both require `*.view`, which is an admin-panel capability).
- **CSRF:** `SameSite=Strict` + Origin/Referer allow-list on state-changing requests.
- **Injection:** all SQL parameterized by Drizzle; LIKE wildcards escaped; `:id` is UUID-validated
  before reaching the DB.
- **Mass assignment:** Zod strips unknown keys; DTOs are mapped field by field, so `passwordHash`,
  `tokenHash` and internal flags can never be set by the client or serialized to it.
- **Enumeration:** uniform error message and equal hashing cost for unknown emails; lockout keyed
  on hashed email so it never confirms an account.
- **Headers / errors:** strict CSP, `nosniff`, frame-deny, `no-store`, HSTS in production,
  `x-powered-by` off; 5xx details are logged, never returned.

## Re-audit

A second full pass re-checked both fixes and every item above and found #3. The advisory-lock
fix (#2) was confirmed correct: under READ COMMITTED the count query issued after acquiring the
lock takes a fresh snapshot, so the second transaction sees the first one's committed change.

## Residual risks (accepted / deployment-level)

- **Account-lockout as availability tradeoff:** 5 failed logins lock an email for 15 min, so a
  known email can be kept locked. This is inherent to lockout; the alternative (no lockout) is worse.
  Mitigate operationally with proxy-level IP reputation / CAPTCHA if abused.
- **Distributed attacks:** the per-/64 key stops single-allocation rotation, not botnets spread over
  many networks. The durable per-email throttle (5 / 15 min) remains the brute-force backstop.
  Under a flood of >50 000 distinct keys the in-memory limiter resets (fail-open, by design to bound
  memory); the DB throttle is unaffected.
- **Frontend security headers:** the SPA's static files need `Content-Security-Policy`,
  `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options` and HSTS from the web server
  (e.g. Nginx) in production — the API's headers only cover API responses.
- **In-memory limiter is per-instance:** correct for one instance; add reverse-proxy rate limiting
  for multi-instance or hardened DoS protection.
- **`GET /api/health`** is public and reveals DB-reachability + uptime (needed by load balancers).
  Minimal recon value; restrict at the proxy if undesired.
- **`TRUST_PROXY` must match the real topology** — too trusting lets `X-Forwarded-For` spoof the
  throttle IP; too strict buckets all users under the proxy IP.

## Verification

- Password-hash correctness preserved through the concurrency gate; 61 concurrent hashes resolve
  with no deadlock.
- Rate limiter: 15 pass then `429`, isolated per IP, resets after the window.
- IP keying: IPv4, IPv4-mapped, compressed IPv6, zone ids and embedded-IPv4 forms normalize
  correctly; 1 000 random addresses inside one /64 collapse to a single bucket.
- Syntax, architectural-boundary and import/export checks pass. Full `pnpm verify` (typecheck +
  build) and live DB behaviour still need to run on the deployment host.

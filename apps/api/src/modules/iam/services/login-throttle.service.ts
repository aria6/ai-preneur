import type { DatabaseExecutor } from '@ai-preneur/database';

import { clientRateKey } from '../../../core/client-ip.js';
import { tooManyRequests } from '../../../core/errors.js';
import { createThrottlesRepository } from '../repositories/throttles.repository.js';
import { sha256Hex } from '../security/tokens.js';

/**
 * Brute-force protection, persisted in PostgreSQL (survives restarts, works with
 * several API instances).
 *
 *  - per email : 5 failures / 15 min → locked 15 min (also for unknown emails,
 *                so a lock never reveals whether an account exists)
 *  - per IP    : 50 failures / 15 min → locked 15 min (password spraying; IPv6 per /64)
 *  - per user  : 5 wrong "current password" / 15 min on password change
 */
const POLICIES = {
  email: { maxAttempts: 5, windowSeconds: 15 * 60, lockSeconds: 15 * 60 },
  ip: { maxAttempts: 50, windowSeconds: 15 * 60, lockSeconds: 15 * 60 },
  passwordChange: { maxAttempts: 5, windowSeconds: 15 * 60, lockSeconds: 15 * 60 },
} as const;

const LOCKED_MESSAGE = 'Terlalu banyak percobaan gagal. Silakan coba lagi nanti.';

export function createLoginThrottle(db: DatabaseExecutor) {
  const repo = createThrottlesRepository(db);

  const emailKey = (email: string) => `email:${sha256Hex(email)}`;
  // IPv6 grouped by /64 so rotating addresses inside one allocation cannot evade the limit.
  const ipKey = (ip: string) => `ip:${sha256Hex(clientRateKey(ip))}`;
  const passwordKey = (userId: string) => `pwd:${userId}`;

  async function assertNotLocked(keys: string[]): Promise<void> {
    const lockedUntil = await repo.findActiveLock(keys);
    if (lockedUntil) {
      throw tooManyRequests(LOCKED_MESSAGE, (lockedUntil.getTime() - Date.now()) / 1000);
    }
  }

  return {
    async assertLoginAllowed(email: string, ip: string | undefined): Promise<void> {
      await assertNotLocked(ip ? [emailKey(email), ipKey(ip)] : [emailKey(email)]);
    },

    async registerLoginFailure(email: string, ip: string | undefined): Promise<void> {
      await repo.registerFailure(emailKey(email), POLICIES.email);
      if (ip) await repo.registerFailure(ipKey(ip), POLICIES.ip);
    },

    async registerLoginSuccess(email: string): Promise<void> {
      await repo.reset(emailKey(email));
    },

    async assertPasswordChangeAllowed(userId: string): Promise<void> {
      await assertNotLocked([passwordKey(userId)]);
    },

    async registerPasswordChangeFailure(userId: string): Promise<void> {
      await repo.registerFailure(passwordKey(userId), POLICIES.passwordChange);
    },

    async registerPasswordChangeSuccess(userId: string): Promise<void> {
      await repo.reset(passwordKey(userId));
    },
  };
}

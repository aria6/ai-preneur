import type { Database } from '@ai-preneur/database';
import type { AuthUser, LoginRequest } from '@ai-preneur/shared';

import { forbidden, unauthorized } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import { effectivePermissions, type AuthContext } from '../access-policy.js';
import type { IamConfig } from '../iam.config.js';
import { toAuthUser } from '../iam.mappers.js';
import { createRolesRepository } from '../repositories/roles.repository.js';
import { createSessionsRepository } from '../repositories/sessions.repository.js';
import { createUsersRepository } from '../repositories/users.repository.js';
import {
  burnPasswordVerification,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../security/password.js';
import { generateSessionToken, isWellFormedSessionToken, sha256Hex } from '../security/tokens.js';
import { createLoginThrottle } from './login-throttle.service.js';

export interface ClientInfo {
  ip: string | undefined;
  userAgent: string | undefined;
}

const INVALID_CREDENTIALS = 'Email atau password salah.';

export function createAuthService(deps: { db: Database; config: IamConfig; logger: Logger }) {
  const { db, config, logger } = deps;
  const users = createUsersRepository(db);
  const roles = createRolesRepository(db);
  const sessions = createSessionsRepository(db);
  const throttle = createLoginThrottle(db);

  async function issueSession(userId: string, client: ClientInfo): Promise<string> {
    const token = generateSessionToken();
    await sessions.create({
      userId,
      tokenHash: sha256Hex(token),
      ttlHours: config.sessionTtlHours,
      ipAddress: client.ip?.slice(0, 64) ?? null,
      userAgent: client.userAgent?.slice(0, 512) ?? null,
    });
    return token;
  }

  async function resolveSession(token: string): Promise<AuthContext | null> {
    if (!isWellFormedSessionToken(token)) return null;

    const row = await sessions.findValidByTokenHash(sha256Hex(token), config.sessionIdleTimeoutMinutes);
    if (!row) return null;

    if (!row.isActive) {
      await sessions.deleteById(row.sessionId);
      return null;
    }

    const [granted] = await Promise.all([
      row.roleIsSystem ? Promise.resolve([]) : roles.findPermissions(row.roleId),
      sessions.touch(row.sessionId),
    ]);

    return {
      sessionId: row.sessionId,
      user: {
        id: row.userId,
        email: row.email,
        name: row.name,
        roleId: row.roleId,
        roleName: row.roleName,
        isSystemRole: row.roleIsSystem,
      },
      permissions: new Set(effectivePermissions({ isSystem: row.roleIsSystem, permissions: granted })),
    };
  }

  return {
    resolveSession,

    /**
     * Verifies credentials and opens a new session (fresh token → no session fixation).
     * Every failure path returns the same message, and unknown emails still pay the
     * hashing cost, so neither responses nor timing reveal which accounts exist.
     */
    async login(input: LoginRequest, client: ClientInfo): Promise<{ token: string; user: AuthUser }> {
      await throttle.assertLoginAllowed(input.email, client.ip);

      const credentials = await users.findCredentialsByEmail(input.email);
      let passwordOk = false;
      if (credentials) {
        passwordOk = await verifyPassword(input.password, credentials.passwordHash);
      } else {
        await burnPasswordVerification(input.password);
      }

      if (!credentials || !passwordOk) {
        await throttle.registerLoginFailure(input.email, client.ip);
        logger.warn('Failed login attempt', { ip: client.ip });
        throw unauthorized(INVALID_CREDENTIALS);
      }

      // Password is correct here, so revealing the disabled state leaks nothing new.
      if (!credentials.isActive) {
        throw forbidden('Akun Anda dinonaktifkan. Hubungi administrator.');
      }

      await throttle.registerLoginSuccess(input.email);

      if (needsRehash(credentials.passwordHash)) {
        await users.upgradePasswordHash(credentials.id, await hashPassword(input.password));
      }

      await sessions.deleteExpiredForUser(credentials.id);
      const token = await issueSession(credentials.id, client);
      await users.touchLastLogin(credentials.id);

      const ctx = await resolveSession(token);
      if (!ctx) throw new Error('Freshly issued session could not be resolved');

      logger.info('User logged in', { userId: credentials.id });
      return { token, user: toAuthUser(ctx) };
    },

    async logout(sessionId: string): Promise<void> {
      await sessions.deleteById(sessionId);
    },

    /** Revokes a session by raw token (used when no valid context exists). */
    async revokeToken(token: string): Promise<void> {
      if (isWellFormedSessionToken(token)) await sessions.deleteByTokenHash(sha256Hex(token));
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

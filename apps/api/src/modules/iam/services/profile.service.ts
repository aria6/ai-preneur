import type { Database } from '@ai-preneur/database';
import type { AuthUser, ChangePasswordRequest, UpdateProfileRequest } from '@ai-preneur/shared';

import { fieldError, unauthorized } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import type { AuthContext } from '../access-policy.js';
import type { IamConfig } from '../iam.config.js';
import { toAuthUser } from '../iam.mappers.js';
import { createSessionsRepository } from '../repositories/sessions.repository.js';
import { createUsersRepository } from '../repositories/users.repository.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { generateSessionToken, sha256Hex } from '../security/tokens.js';
import type { ClientInfo } from './auth.service.js';
import { createLoginThrottle } from './login-throttle.service.js';

/** Self-service account management. Users can change only their name and password. */
export function createProfileService(deps: { db: Database; config: IamConfig; logger: Logger }) {
  const { db, config, logger } = deps;
  const users = createUsersRepository(db);
  const throttle = createLoginThrottle(db);

  return {
    async updateProfile(ctx: AuthContext, input: UpdateProfileRequest): Promise<AuthUser> {
      await users.update(ctx.user.id, { name: input.name });
      return toAuthUser({ ...ctx, user: { ...ctx.user, name: input.name } });
    },

    /**
     * Requires the current password (a stolen session alone cannot take over the
     * account), then revokes EVERY session of the user and issues a fresh one for
     * the current device. Returns the new session token.
     */
    async changePassword(
      ctx: AuthContext,
      input: ChangePasswordRequest,
      client: ClientInfo,
    ): Promise<string> {
      await throttle.assertPasswordChangeAllowed(ctx.user.id);

      const storedHash = await users.findPasswordHash(ctx.user.id);
      if (!storedHash) throw unauthorized();

      if (!(await verifyPassword(input.currentPassword, storedHash))) {
        await throttle.registerPasswordChangeFailure(ctx.user.id);
        throw fieldError('currentPassword', 'Password saat ini salah.');
      }

      const newHash = await hashPassword(input.newPassword);
      const token = generateSessionToken();

      // One transaction → passwordChangedAt and the new session's createdAt share
      // the same now(), so only the new session survives the cut-off.
      await db.transaction(async (tx) => {
        const txUsers = createUsersRepository(tx);
        const txSessions = createSessionsRepository(tx);
        await txUsers.updatePassword(ctx.user.id, newHash);
        await txSessions.deleteAllForUser(ctx.user.id);
        await txSessions.create({
          userId: ctx.user.id,
          tokenHash: sha256Hex(token),
          ttlHours: config.sessionTtlHours,
          ipAddress: client.ip?.slice(0, 64) ?? null,
          userAgent: client.userAgent?.slice(0, 512) ?? null,
        });
      });

      await throttle.registerPasswordChangeSuccess(ctx.user.id);
      logger.info('User changed password', { userId: ctx.user.id });
      return token;
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;

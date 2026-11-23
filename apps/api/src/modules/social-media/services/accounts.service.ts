import { isUniqueViolation, type Database } from '@ai-preneur/database';
import type { BatchDetailDto, ConnectInstagramRequest, SocialPlatform } from '@ai-preneur/shared';

import { fieldError } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import type { AuthContext } from '../../iam/index.js';
import { fetchInstagramAccount, InstagramApiError } from '../integrations/instagram.client.js';
import { createAccountsRepository } from '../repositories/accounts.repository.js';
import {
  credentialsContext,
  CredentialsKeyMissingError,
  type CredentialsCipher,
} from '../security/credentials-cipher.js';
import { batchPlatforms } from '../social.mappers.js';
import {
  assertDraft,
  credentialsKeyError,
  loadBatchDetail,
  loadWorkingSet,
} from './batch-context.js';

/**
 * Social accounts belong to one idea (batch) per platform, and one platform account
 * can never serve two ideas (enforced by a unique index). Tokens are encrypted at
 * rest and never returned to the client.
 */
export function createAccountsService(deps: {
  db: Database;
  cipher: CredentialsCipher;
  logger: Logger;
}) {
  const { db, cipher, logger } = deps;

  return {
    async connectInstagram(
      ctx: AuthContext,
      batchId: string,
      input: ConnectInstagramRequest,
    ): Promise<BatchDetailDto> {
      const current = await loadWorkingSet(db, batchId, new Date());
      assertDraft(current.batch, 'Menghubungkan akun');
      if (!batchPlatforms(current.batch).includes('instagram')) {
        throw fieldError(
          'accessToken',
          'Centang Instagram pada pilihan media sosial terlebih dahulu.',
        );
      }
      if (!cipher.configured) throw credentialsKeyError(new CredentialsKeyMissingError());

      let account: Awaited<ReturnType<typeof fetchInstagramAccount>>;
      try {
        account = await fetchInstagramAccount(input.accessToken);
      } catch (error) {
        if (error instanceof InstagramApiError) throw fieldError('accessToken', error.message);
        throw error;
      }

      try {
        await db.transaction(async (tx) => {
          const locked = await loadWorkingSet(tx, batchId, new Date(), { forUpdate: true });
          assertDraft(locked.batch, 'Menghubungkan akun');
          await createAccountsRepository(tx).upsertForBatch({
            batchId,
            platform: 'instagram',
            externalAccountId: account.userId,
            username: account.username,
            accountType: account.accountType,
            encryptedCredentials: cipher.encrypt(
              { accessToken: input.accessToken },
              credentialsContext(batchId, 'instagram'),
            ),
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw fieldError(
            'accessToken',
            `Akun @${account.username} sudah terhubung ke ide lain. Satu akun hanya boleh dipakai satu ide.`,
          );
        }
        throw credentialsKeyError(error);
      }

      logger.info('Social account connected', {
        actorId: ctx.user.id,
        batchId,
        platform: 'instagram',
      });
      return loadBatchDetail(db, batchId);
    },

    async disconnect(
      ctx: AuthContext,
      batchId: string,
      platform: SocialPlatform,
    ): Promise<BatchDetailDto> {
      await db.transaction(async (tx) => {
        const working = await loadWorkingSet(tx, batchId, new Date(), { forUpdate: true });
        assertDraft(working.batch, 'Memutuskan akun');
        await createAccountsRepository(tx).deleteForBatch(batchId, platform);
      });
      logger.info('Social account disconnected', { actorId: ctx.user.id, batchId, platform });
      return loadBatchDetail(db, batchId);
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;

import { isUniqueViolation, type Database } from '@ai-preneur/database';
import type {
  BatchDetailDto,
  ConnectInstagramRequest,
  InstagramAccountOption,
  LookupInstagramAccountsRequest,
  SocialPlatform,
} from '@ai-preneur/shared';

import { fieldError } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import type { AuthContext } from '../../iam/index.js';
import {
  InstagramApiError,
  listInstagramAccounts,
  type InstagramAccount,
} from '../integrations/instagram.client.js';
import { createAccountsRepository } from '../repositories/accounts.repository.js';
import {
  credentialsContext,
  CredentialsKeyMissingError,
  type CredentialsCipher,
} from '../security/credentials-cipher.js';
import { batchPlatforms } from '../social.mappers.js';
import {
  assertDraft,
  assertNotArchived,
  credentialsKeyError,
  loadBatchDetail,
  loadWorkingSet,
  reopenIfCompleted,
} from './batch-context.js';

/**
 * The account to connect: the chosen one (it must be reachable with the token), or
 * the token's only account.
 */
function pickAccount(
  accounts: readonly InstagramAccount[],
  chosenId: string | undefined,
): InstagramAccount {
  if (chosenId) {
    const chosen = accounts.find((candidate) => candidate.userId === chosenId);
    if (!chosen) {
      throw fieldError(
        'instagramAccountId',
        'Akun Instagram ini tidak bisa diakses dengan token tersebut.',
      );
    }
    return chosen;
  }
  const [only, ...others] = accounts;
  if (!only || others.length > 0) {
    throw fieldError(
      'instagramAccountId',
      'Token ini bisa mengakses beberapa akun Instagram. Pilih salah satu akun.',
    );
  }
  return only;
}

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

  /** Checks the batch can take an Instagram account, then asks Instagram for the token's accounts. */
  async function accountsForToken(
    batchId: string,
    accessToken: string,
    action: string,
  ): Promise<InstagramAccount[]> {
    const current = await loadWorkingSet(db, batchId, new Date());
    // Selesai may change its account too (it becomes Draft once the account is saved).
    assertNotArchived(current.batch);
    if (current.batch.status !== 'completed') assertDraft(current.batch, action);
    if (!batchPlatforms(current.batch).includes('instagram')) {
      throw fieldError(
        'accessToken',
        'Centang Instagram pada pilihan media sosial terlebih dahulu.',
      );
    }
    try {
      return await listInstagramAccounts(accessToken);
    } catch (error) {
      if (error instanceof InstagramApiError) throw fieldError('accessToken', error.message);
      throw error;
    }
  }

  return {
    /**
     * "Tes token": the Instagram accounts the token can publish to, so the user can pick
     * one when a business-portfolio token reaches several. Nothing is stored.
     */
    async lookupInstagramAccounts(
      _ctx: AuthContext,
      batchId: string,
      input: LookupInstagramAccountsRequest,
    ): Promise<InstagramAccountOption[]> {
      const accounts = await accountsForToken(batchId, input.accessToken, 'Menghubungkan akun');
      const connected = await createAccountsRepository(db).findByExternalIds(
        'instagram',
        accounts.map((account) => account.userId),
      );
      return accounts.map((account) => ({
        id: account.userId,
        username: account.username,
        usedByOtherBatch: connected.some(
          (row) => row.externalAccountId === account.userId && row.batchId !== batchId,
        ),
      }));
    },

    async connectInstagram(
      ctx: AuthContext,
      batchId: string,
      input: ConnectInstagramRequest,
    ): Promise<BatchDetailDto> {
      if (!cipher.configured) throw credentialsKeyError(new CredentialsKeyMissingError());
      const accounts = await accountsForToken(batchId, input.accessToken, 'Menghubungkan akun');

      const account = pickAccount(accounts, input.instagramAccountId);

      try {
        await db.transaction(async (tx) => {
          const locked = await loadWorkingSet(tx, batchId, new Date(), { forUpdate: true });
          assertDraft(await reopenIfCompleted(tx, locked.batch), 'Menghubungkan akun');
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
        assertDraft(await reopenIfCompleted(tx, working.batch), 'Memutuskan akun');
        await createAccountsRepository(tx).deleteForBatch(batchId, platform);
      });
      logger.info('Social account disconnected', { actorId: ctx.user.id, batchId, platform });
      return loadBatchDetail(db, batchId);
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;

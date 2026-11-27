import type { Database, SmAccountRow, SmBatchRow } from '@ai-preneur/database';

import { conflict, notFound } from '../../../core/errors.js';
import { parseInstagramCredentials } from '../publishers/instagram.publisher.js';
import { createAccountsRepository } from '../repositories/accounts.repository.js';
import { createBatchesRepository } from '../repositories/batches.repository.js';
import { credentialsContext, type CredentialsCipher } from '../security/credentials-cipher.js';
import { credentialsKeyError } from './batch-context.js';

export interface InstagramAccess {
  batch: SmBatchRow;
  account: SmAccountRow;
  accessToken: string;
}

/**
 * The idea's connected Instagram account and its decrypted token, for the read-only
 * agents (Performance AIgent, Data Collection AIgent). Throws a message the page can
 * show when something is missing.
 */
export function createInstagramAccess(deps: { db: Database; cipher: CredentialsCipher }) {
  const batches = createBatchesRepository(deps.db);
  const accounts = createAccountsRepository(deps.db);

  /** The usable account and token, or the reason there is none (not thrown). */
  async function resolve(
    batchId: string,
  ): Promise<
    { batch: SmBatchRow; account: SmAccountRow | null } & (
      { accessToken: string; problem: null } | { accessToken: null; problem: Error }
    )
  > {
    const batch = await batches.findById(batchId);
    if (!batch) throw notFound('Ide tidak ditemukan.');
    const account = (await accounts.findForBatch(batchId, 'instagram')) ?? null;
    if (!account) {
      return {
        batch,
        account,
        accessToken: null,
        problem: conflict(
          'Ide ini belum punya akun Instagram yang terhubung. Hubungkan akun di Publisher AIgent.',
        ),
      };
    }
    if (account.status === 'error') {
      return {
        batch,
        account,
        accessToken: null,
        problem: conflict(
          account.lastError ??
            'Akun Instagram ide ini bermasalah. Hubungkan ulang akun di Publisher AIgent.',
        ),
      };
    }
    try {
      const { accessToken } = parseInstagramCredentials(
        deps.cipher.decrypt(account.encryptedCredentials, credentialsContext(batchId, 'instagram')),
      );
      return { batch, account, accessToken, problem: null };
    } catch (error) {
      const keyError = credentialsKeyError(error);
      return {
        batch,
        account,
        accessToken: null,
        problem:
          keyError !== error && keyError instanceof Error
            ? keyError
            : conflict(
                'Kredensial Instagram tidak terbaca. Hubungkan ulang akun di Publisher AIgent.',
              ),
      };
    }
  }

  return {
    resolve,
    async load(batchId: string): Promise<InstagramAccess> {
      const result = await resolve(batchId);
      if (result.problem) throw result.problem;
      return {
        batch: result.batch,
        account: result.account as SmAccountRow,
        accessToken: result.accessToken,
      };
    },
  };
}

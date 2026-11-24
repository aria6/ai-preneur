import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { Database, SmAccountRow, SmBatchRow, SmQueueItemRow } from '@ai-preneur/database';
import type { SocialPlatform } from '@ai-preneur/shared';

import type { Logger } from '../../../core/logger.js';
import { createAccountsRepository } from '../repositories/accounts.repository.js';
import { createBatchesRepository } from '../repositories/batches.repository.js';
import { createItemsRepository } from '../repositories/items.repository.js';
import { createPublicationsRepository } from '../repositories/publications.repository.js';
import { credentialsContext, type CredentialsCipher } from '../security/credentials-cipher.js';
import { batchPlatforms } from '../social.mappers.js';
import { PublishError, type PlatformPublisher } from './publisher.js';

const MINUTE = 60_000;
const BATCH_SIZE = 20;

/** Total attempts for an upload that keeps failing with a temporary error. */
export const MAX_ATTEMPTS = 4;
/** Wait before attempt 2, 3, 4. */
const RETRY_DELAYS_MS = [5 * MINUTE, 30 * MINUTE, 120 * MINUTE] as const;
/** One attempt (download + upload + processing + publish) is aborted after this. */
const ATTEMPT_TIMEOUT_MS = 30 * MINUTE;
/** A "processing" row older than this belongs to a worker that died. */
const STALE_AFTER_MS = 45 * MINUTE;
/** How often accounts are checked for a token refresh. */
const TOKEN_CHECK_INTERVAL_MS = 60 * MINUTE;
/** Refresh long-lived tokens that expire within this many days. */
const REFRESH_WITHIN_DAYS = 30;
/** Leftover temp videos older than this are deleted. */
const TEMP_FILE_MAX_AGE_MS = 2 * ATTEMPT_TIMEOUT_MS;

/** When the next automatic attempt runs, or null when the upload gives up. */
export function nextRetryAt(attemptsDone: number, now: Date): Date | null {
  if (attemptsDone >= MAX_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MS[Math.max(0, attemptsDone - 1)] ?? RETRY_DELAYS_MS.at(-1)!;
  return new Date(now.getTime() + delay);
}

export interface PublisherWorker {
  start(): void;
  /** Stops polling, aborts the in-flight upload (it is retried on next start) and waits. */
  stop(): Promise<void>;
}

interface Attempt {
  publicationId: string;
  attempts: number;
  item: SmQueueItemRow;
  batch: SmBatchRow;
  platform: SocialPlatform;
}

/**
 * Uploads due rows at their schedule. Runs inside the API process and polls
 * PostgreSQL — no Redis/queue. Safe with several API instances: every attempt is
 * claimed atomically (insert on a unique index, or a guarded update for retries),
 * so an upload is never attempted twice at the same time.
 *
 * Each round: recover attempts left "processing" by a dead worker, refresh tokens
 * (hourly), run first uploads, run due retries, then mark finished batches "completed".
 */
export function createPublisherWorker(deps: {
  db: Database;
  logger: Logger;
  cipher: CredentialsCipher;
  intervalMs: number;
  publishers: readonly PlatformPublisher[];
  tempDir: string;
}): PublisherWorker {
  const { db, logger, cipher, intervalMs, tempDir } = deps;
  const publishers = new Map<SocialPlatform, PlatformPublisher>(
    deps.publishers.map((p) => [p.platform, p]),
  );
  const items = createItemsRepository(db);
  const publications = createPublicationsRepository(db);
  const accounts = createAccountsRepository(db);
  const batches = createBatchesRepository(db);

  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | null = null;
  let stopped = true;
  let shutdown = new AbortController();
  let lastTokenCheck = 0;

  function decrypt(account: SmAccountRow): unknown {
    return cipher.decrypt(
      account.encryptedCredentials,
      credentialsContext(account.batchId, account.platform),
    );
  }

  async function fail(attempt: Attempt, message: string, retryAt: Date | null): Promise<void> {
    await publications.markFailed(attempt.publicationId, message, retryAt);
    logger.warn('Video publish failed', {
      itemId: attempt.item.id,
      platform: attempt.platform,
      attempts: attempt.attempts,
      retryAt,
      message,
    });
  }

  async function runAttempt(attempt: Attempt): Promise<void> {
    const { item, batch, platform } = attempt;
    const publisher = publishers.get(platform);
    if (!publisher) {
      await fail(attempt, 'Platform ini belum didukung untuk unggah otomatis.', null);
      return;
    }

    const account = await accounts.findForBatch(batch.id, platform);
    if (!account) {
      await fail(attempt, 'Akun media sosial untuk ide ini belum terhubung.', null);
      return;
    }
    if (account.status === 'error') {
      await fail(
        attempt,
        account.lastError ?? 'Akun media sosial bermasalah. Hubungkan ulang akun untuk ide ini.',
        null,
      );
      return;
    }

    let credentials: unknown;
    try {
      credentials = decrypt(account);
    } catch (error) {
      logger.error('Publish credentials unavailable', { itemId: item.id, platform, error });
      await fail(attempt, 'Kredensial akun tidak dapat dibaca. Hubungkan ulang akun.', null);
      return;
    }

    const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]);
    try {
      const result = await publisher.publish(
        {
          batchId: batch.id,
          itemId: item.id,
          platform,
          title: item.title,
          caption: item.caption,
          hashtags: item.hashtags,
          videoFileId: item.videoFileId,
          thumbnailFileId: item.thumbnailFileId,
          credentials,
          externalAccountId: account.externalAccountId,
        },
        {
          signal,
          onContainerCreated: (containerId) =>
            publications.setContainer(attempt.publicationId, containerId),
          onPublishRequested: () => publications.setPublishRequested(attempt.publicationId),
        },
      );
      await publications.markPublished(attempt.publicationId, result);
      logger.info('Video published', { itemId: item.id, platform, url: result.externalUrl });
    } catch (error) {
      const now = new Date();
      if (shutdown.signal.aborted) {
        await fail(attempt, 'Unggahan dihentikan karena server dimatikan; akan diulang.', now);
        return;
      }
      if (error instanceof PublishError) {
        if (error.tokenInvalid) {
          await accounts.markError(account.id, error.message, account.encryptedCredentials);
        }
        await fail(
          attempt,
          error.message,
          error.retryable ? nextRetryAt(attempt.attempts, now) : null,
        );
        return;
      }
      logger.error('Unexpected publish error', { itemId: item.id, platform, error });
      await fail(
        attempt,
        signal.aborted
          ? 'Unggahan melebihi batas waktu 30 menit.'
          : 'Terjadi kesalahan saat mengunggah video.',
        nextRetryAt(attempt.attempts, now),
      );
    }
  }

  /** Attempts left "processing" by a worker that died (crash, kill, deploy). */
  async function recoverStale(): Promise<void> {
    const stale = await publications.findStale(new Date(Date.now() - STALE_AFTER_MS));
    for (const { publication, batchId } of stale) {
      const now = new Date();
      const failWith = (message: string, retryAt: Date | null) =>
        publications.markFailed(publication.id, message, retryAt);

      if (!publication.publishRequestedAt) {
        // Never reached the publish call: nothing is live, repeat it.
        await failWith('Unggahan terhenti karena server berhenti; akan diulang.', now);
        logger.warn('Recovered interrupted upload', { publicationId: publication.id });
        continue;
      }

      const publisher = publishers.get(publication.platform);
      const account = await accounts.findForBatch(batchId, publication.platform);
      let outcome: Awaited<ReturnType<PlatformPublisher['recover']>> = { state: 'unknown' };
      if (publisher && account && publication.containerId) {
        try {
          outcome = await publisher.recover(decrypt(account), publication.containerId);
        } catch (error) {
          logger.error('Recovery check failed', { publicationId: publication.id, error });
        }
      }

      if (outcome.state === 'published') {
        await publications.markPublished(publication.id, outcome.result);
      } else if (outcome.state === 'not_published') {
        await failWith('Unggahan terhenti sebelum dipublikasikan; akan diulang.', now);
      } else {
        await failWith(
          'Status publikasi tidak pasti (server berhenti saat memublikasikan). Periksa Instagram sebelum menekan "Coba lagi".',
          null,
        );
      }
      logger.warn('Recovered interrupted publish', {
        publicationId: publication.id,
        outcome: outcome.state,
      });
    }
  }

  async function refreshTokens(): Promise<void> {
    if (Date.now() - lastTokenCheck < TOKEN_CHECK_INTERVAL_MS) return;
    lastTokenCheck = Date.now();

    for (const publisher of publishers.values()) {
      if (!publisher.refreshCredentials) continue;
      const due = await accounts.findDueForRefresh(publisher.platform, REFRESH_WITHIN_DAYS);
      for (const account of due) {
        try {
          const refreshed = await publisher.refreshCredentials(decrypt(account));
          await accounts.replaceCredentials(
            account.id,
            account.encryptedCredentials,
            cipher.encrypt(
              refreshed.credentials,
              credentialsContext(account.batchId, account.platform),
            ),
            refreshed.expiresAt,
          );
          logger.info('Social token refreshed', {
            batchId: account.batchId,
            platform: account.platform,
            expiresAt: refreshed.expiresAt,
          });
        } catch (error) {
          if (error instanceof PublishError && error.tokenInvalid) {
            await accounts.markError(account.id, error.message, account.encryptedCredentials);
          } else {
            await accounts.touch(account.id); // try again in 24 h
          }
          logger.warn('Social token refresh failed', {
            batchId: account.batchId,
            platform: account.platform,
            error,
          });
        }
      }
    }
  }

  async function runFirstUploads(): Promise<void> {
    const due = await items.findDue(BATCH_SIZE);
    for (const { item, batch } of due) {
      for (const platform of batchPlatforms(batch)) {
        if (shutdown.signal.aborted) return;
        const publicationId = await publications.claim(item.id, platform);
        if (!publicationId) continue; // already attempted
        await runAttempt({ publicationId, attempts: 1, item, batch, platform });
      }
    }
  }

  async function runRetries(): Promise<void> {
    const due = await publications.findRetryDue(BATCH_SIZE);
    for (const { publication, item, batch } of due) {
      if (shutdown.signal.aborted) return;
      if (!(await publications.reclaim(publication.id))) continue;
      await runAttempt({
        publicationId: publication.id,
        attempts: publication.attempts + 1,
        item,
        batch,
        platform: publication.platform,
      });
    }
  }

  async function cleanTempDir(): Promise<void> {
    const entries = await readdir(tempDir).catch(() => [] as string[]);
    for (const name of entries) {
      const path = join(tempDir, name);
      const info = await stat(path).catch(() => null);
      if (info && Date.now() - info.mtimeMs > TEMP_FILE_MAX_AGE_MS) {
        await rm(path, { force: true, recursive: true }).catch(() => undefined);
      }
    }
  }

  async function tick(): Promise<void> {
    await recoverStale();
    await refreshTokens();
    await runFirstUploads();
    await runRetries();
    const completed = await batches.completeFinished();
    for (const batchId of completed) logger.info('Publisher batch completed', { batchId });
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = tick()
        .catch((error: unknown) => logger.error('Publisher tick failed', { error }))
        .finally(() => {
          inFlight = null;
          scheduleNext();
        });
    }, intervalMs);
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      shutdown = new AbortController();
      logger.info('Social publisher worker started', { intervalMs });
      void cleanTempDir();
      scheduleNext();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      shutdown.abort();
      if (inFlight) await inFlight;
    },
  };
}

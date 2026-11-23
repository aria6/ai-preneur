import type { Database } from '@ai-preneur/database';
import type { SocialPlatform } from '@ai-preneur/shared';

import type { Logger } from '../../../core/logger.js';
import { createAccountsRepository } from '../repositories/accounts.repository.js';
import { createItemsRepository } from '../repositories/items.repository.js';
import { createPublicationsRepository } from '../repositories/publications.repository.js';
import { credentialsContext, type CredentialsCipher } from '../security/credentials-cipher.js';
import { batchPlatforms } from '../social.mappers.js';
import { PublishError, type PlatformPublisher } from './publisher.js';

const BATCH_SIZE = 20;

export interface PublisherWorker {
  start(): void;
  /** Stops polling and waits for the in-flight tick to finish. */
  stop(): Promise<void>;
}

/**
 * Uploads due rows at their schedule. Runs inside the API process and polls
 * PostgreSQL — no Redis/queue. Safe with several API instances: every
 * (row, platform) upload is claimed with an atomic insert on a unique index,
 * so it can only ever be attempted once.
 *
 * TODO (Tahap 2): retry policy for failed uploads, recovery of rows left in
 * "processing" after a crash, and marking batches "completed".
 */
export function createPublisherWorker(deps: {
  db: Database;
  logger: Logger;
  cipher: CredentialsCipher;
  intervalMs: number;
  publishers: readonly PlatformPublisher[];
}): PublisherWorker {
  const { db, logger, cipher, intervalMs } = deps;
  const publishers = new Map<SocialPlatform, PlatformPublisher>(
    deps.publishers.map((p) => [p.platform, p]),
  );
  const items = createItemsRepository(db);
  const publications = createPublicationsRepository(db);
  const accounts = createAccountsRepository(db);

  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | null = null;
  let stopped = true;

  async function publishOne(
    publicationId: string,
    job: Parameters<PlatformPublisher['publish']>[0],
  ) {
    const publisher = publishers.get(job.platform);
    try {
      if (!publisher) throw new PublishError('Platform ini belum didukung untuk unggah otomatis.');
      const result = await publisher.publish(job);
      await publications.markPublished(publicationId, result);
      logger.info('Video published', { itemId: job.itemId, platform: job.platform });
    } catch (error) {
      const message =
        error instanceof PublishError ? error.message : 'Terjadi kesalahan saat mengunggah video.';
      await publications.markFailed(publicationId, message);
      logger.error('Video publish failed', { itemId: job.itemId, platform: job.platform, error });
    }
  }

  async function tick(): Promise<void> {
    const due = await items.findDue(BATCH_SIZE);
    for (const { item, batch } of due) {
      for (const platform of batchPlatforms(batch)) {
        const publicationId = await publications.claim(item.id, platform);
        if (!publicationId) continue; // already attempted

        let credentials: unknown = null;
        try {
          const account = await accounts.findForBatch(batch.id, platform);
          if (!account) throw new PublishError('Akun media sosial untuk ide ini belum terhubung.');
          credentials = cipher.decrypt(
            account.encryptedCredentials,
            credentialsContext(batch.id, platform),
          );
        } catch (error) {
          const message =
            error instanceof PublishError ? error.message : 'Kredensial akun tidak dapat dibaca.';
          await publications.markFailed(publicationId, message);
          logger.error('Publish credentials unavailable', { itemId: item.id, platform, error });
          continue;
        }

        await publishOne(publicationId, {
          batchId: batch.id,
          itemId: item.id,
          platform,
          title: item.title,
          caption: item.caption,
          hashtags: item.hashtags,
          videoFileId: item.videoFileId,
          thumbnailFileId: item.thumbnailFileId,
          credentials,
        });
      }
    }
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
      logger.info('Social publisher worker started', { intervalMs });
      scheduleNext();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight;
    },
  };
}

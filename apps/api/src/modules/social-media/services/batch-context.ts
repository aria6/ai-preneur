/**
 * Helpers shared by the Publisher services: loading a batch with everything needed
 * to evaluate row locks, and translating integration errors into API errors.
 */
import type {
  DatabaseExecutor,
  SmBatchRow,
  SmPublicationRow,
  SmQueueItemRow,
} from '@ai-preneur/database';
import {
  ERROR_CODES,
  type BatchDetailDto,
  type ItemLockReason,
  type SocialSettings,
} from '@ai-preneur/shared';

import { AppError, conflict, fieldError, notFound } from '../../../core/errors.js';
import { computeItemLock } from '../domain/queue-rules.js';
import { DriveError } from '../integrations/google-drive.client.js';
import { createAccountsRepository } from '../repositories/accounts.repository.js';
import { createBatchesRepository } from '../repositories/batches.repository.js';
import { createItemsRepository } from '../repositories/items.repository.js';
import { createPublicationsRepository } from '../repositories/publications.repository.js';
import { createSettingsRepository } from '../repositories/settings.repository.js';
import { CredentialsKeyMissingError } from '../security/credentials-cipher.js';
import { batchPlatforms, toBatchDetail, toQueueItemDto } from '../social.mappers.js';

export interface LockedItem {
  item: SmQueueItemRow;
  publications: SmPublicationRow[];
  lockReason: ItemLockReason | null;
}

export interface BatchWorkingSet {
  batch: SmBatchRow;
  settings: SocialSettings;
  items: LockedItem[];
}

export const BATCH_NOT_FOUND = 'Batch tidak ditemukan.';

export function lockMessage(reason: ItemLockReason, lockMinutes: number): string {
  switch (reason) {
    case 'published':
      return 'Baris ini sudah terunggah, sehingga tidak dapat diubah atau dipindahkan.';
    case 'processing':
      return 'Baris ini sedang diunggah, sehingga tidak dapat diubah atau dipindahkan.';
    case 'imminent':
      return `Jadwal unggah baris ini kurang dari ${lockMinutes} menit lagi, sehingga tidak dapat diubah atau dipindahkan.`;
  }
}

export function assertNotCompleted(batch: SmBatchRow): void {
  if (batch.status === 'completed') throw conflict('Batch sudah selesai dan tidak dapat diubah.');
}

export function assertDraft(batch: SmBatchRow, action: string): void {
  if (batch.status !== 'draft') {
    throw conflict(`${action} hanya bisa dilakukan saat Draft. Batalkan jadwal terlebih dahulu.`);
  }
}

export function hasUploads(items: readonly LockedItem[]): boolean {
  return items.some((entry) =>
    entry.publications.some((p) => p.status === 'published' || p.status === 'processing'),
  );
}

/**
 * Loads a batch, its rows and their publications, with the lock state of every row.
 * Pass a transaction executor and `forUpdate` to serialize concurrent edits.
 */
export async function loadWorkingSet(
  db: DatabaseExecutor,
  batchId: string,
  now: Date,
  options: { forUpdate?: boolean } = {},
): Promise<BatchWorkingSet> {
  const batches = createBatchesRepository(db);
  const batch = options.forUpdate
    ? await batches.findByIdForUpdate(batchId)
    : await batches.findById(batchId);
  if (!batch) throw notFound(BATCH_NOT_FOUND);

  const [settings, items] = await Promise.all([
    createSettingsRepository(db).get(),
    createItemsRepository(db).listByBatch(batchId),
  ]);
  const publications = await createPublicationsRepository(db).listByItems(
    items.map((item) => item.id),
  );

  return {
    batch,
    settings,
    items: items.map((item) => {
      const own = publications.filter((p) => p.itemId === item.id);
      const lockReason = computeItemLock(
        {
          batchStatus: batch.status,
          isPaused: item.isPaused,
          scheduledAt: item.scheduledAt,
          publicationStatuses: own.map((p) => p.status),
        },
        settings.lockMinutes,
        now,
      );
      return { item, publications: own, lockReason };
    }),
  };
}

export async function loadBatchDetail(
  db: DatabaseExecutor,
  batchId: string,
): Promise<BatchDetailDto> {
  const now = new Date();
  const working = await loadWorkingSet(db, batchId, now);
  const [accounts, stats] = await Promise.all([
    createAccountsRepository(db).listByBatch(batchId),
    createBatchesRepository(db).stats([batchId]),
  ]);
  const platforms = batchPlatforms(working.batch);
  return toBatchDetail({
    batch: working.batch,
    stats: stats.get(batchId),
    items: working.items.map((entry) =>
      toQueueItemDto(entry.item, entry.publications, platforms, entry.lockReason),
    ),
    accounts,
    settings: working.settings,
    now,
  });
}

/** Maps Google Drive failures to API errors, attached to the given form field. */
export function driveToAppError(error: unknown, field: string): unknown {
  if (!(error instanceof DriveError)) return error;
  if (error.kind === 'not_configured' || error.kind === 'unavailable') {
    return new AppError({
      statusCode: 503,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: error.message,
    });
  }
  return fieldError(field, error.message);
}

export function credentialsKeyError(error: unknown): unknown {
  if (!(error instanceof CredentialsKeyMissingError)) return error;
  return new AppError({
    statusCode: 503,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    message:
      'SOCIAL_CREDENTIALS_KEY belum diatur di server, sehingga akun belum bisa disimpan. Hubungi administrator.',
  });
}

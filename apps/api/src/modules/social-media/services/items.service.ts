import type { Database } from '@ai-preneur/database';
import {
  extractDriveFileId,
  type BatchDetailDto,
  type CreateItemRequest,
  type ResumeItemRequest,
  type PublishNowRequest,
  type UpdateItemRequest,
} from '@ai-preneur/shared';

import { conflict, fieldError, notFound } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import type { AuthContext } from '../../iam/index.js';
import { isImageFile, isVideoFile, type DriveFileRef } from '../domain/filename-parser.js';
import { earliestEditableTime, manualUploadBlock } from '../domain/queue-rules.js';
import type { GoogleDriveClient } from '../integrations/google-drive.client.js';
import { createAccountsRepository } from '../repositories/accounts.repository.js';
import { createItemsRepository, type QueueItemPatch } from '../repositories/items.repository.js';
import { createPublicationsRepository } from '../repositories/publications.repository.js';
import { batchPlatforms } from '../social.mappers.js';
import {
  reopenIfCompleted,
  driveToAppError,
  loadBatchDetail,
  loadWorkingSet,
  lockMessage,
  type BatchWorkingSet,
  type LockedItem,
} from './batch-context.js';

const ITEM_NOT_FOUND = 'Baris tidak ditemukan.';

/** Rows of a scheduled batch must stay outside the lock window and keep a schedule. */
function assertSchedulable(
  working: BatchWorkingSet,
  scheduledAt: Date | null,
  now: Date,
  field = 'scheduledAt',
): void {
  if (working.batch.status !== 'scheduled') return;
  if (scheduledAt === null)
    throw fieldError(field, 'Jadwal unggah wajib diisi karena batch sudah terjadwal.');
  if (scheduledAt < earliestEditableTime(working.settings.lockMinutes, now)) {
    throw fieldError(
      field,
      `Jadwal unggah minimal ${working.settings.lockMinutes} menit dari sekarang.`,
    );
  }
}

function findItem(working: BatchWorkingSet, itemId: string): LockedItem {
  const entry = working.items.find(({ item }) => item.id === itemId);
  if (!entry) throw notFound(ITEM_NOT_FOUND);
  return entry;
}

function assertUnlocked(working: BatchWorkingSet, entry: LockedItem): void {
  if (entry.lockReason) throw conflict(lockMessage(entry.lockReason, working.settings.lockMinutes));
}

/** Queue rows: manual add, edit, delete, pause ("Tunda") and resume. */
export function createItemsService(deps: {
  db: Database;
  drive: GoogleDriveClient;
  logger: Logger;
  /** The running upload worker, or null when SOCIAL_PUBLISHER_ENABLED=false. */
  publisher: { wake(): void } | null;
}) {
  const { db, drive, logger, publisher } = deps;

  async function resolveDriveFile(
    url: string,
    field: string,
    kind: 'video' | 'image',
  ): Promise<DriveFileRef> {
    const fileId = extractDriveFileId(url);
    if (!fileId) throw fieldError(field, 'Link file Google Drive tidak valid.');
    let file: DriveFileRef;
    try {
      file = await drive.getFile(fileId);
    } catch (error) {
      throw driveToAppError(error, field);
    }
    const ok = kind === 'video' ? isVideoFile(file) : isImageFile(file);
    if (!ok)
      throw fieldError(
        field,
        kind === 'video' ? 'File tersebut bukan video.' : 'File tersebut bukan gambar.',
      );
    return file;
  }

  return {
    async create(
      ctx: AuthContext,
      batchId: string,
      input: CreateItemRequest,
    ): Promise<BatchDetailDto> {
      // Drive lookups happen before the transaction (network calls must not hold row locks).
      const video = await resolveDriveFile(input.videoUrl, 'videoUrl', 'video');
      const thumbnail = input.thumbnailUrl
        ? await resolveDriveFile(input.thumbnailUrl, 'thumbnailUrl', 'image')
        : null;

      await db.transaction(async (tx) => {
        const now = new Date();
        const working = await loadWorkingSet(tx, batchId, now, { forUpdate: true });
        await reopenIfCompleted(tx, working.batch);

        const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
        assertSchedulable(working, scheduledAt, now);

        const items = createItemsRepository(tx);
        const next = await items.nextPositionAndTopic(batchId);
        await items.insert(batchId, {
          position: next.position,
          topicNumber: input.topicNumber ?? next.topicNumber,
          partNumber: input.partNumber ?? null,
          title: input.title,
          videoFileId: video.id,
          videoFileName: video.name.slice(0, 300),
          thumbnailFileId: thumbnail?.id ?? null,
          thumbnailFileName: thumbnail?.name.slice(0, 300) ?? null,
          caption: input.caption,
          hashtags: input.hashtags,
          scheduledAt,
          isPaused: false,
        });
      });

      logger.info('Publisher row added', { actorId: ctx.user.id, batchId });
      return loadBatchDetail(db, batchId);
    },

    async update(
      ctx: AuthContext,
      batchId: string,
      itemId: string,
      input: UpdateItemRequest,
    ): Promise<BatchDetailDto> {
      const video = input.videoUrl
        ? await resolveDriveFile(input.videoUrl, 'videoUrl', 'video')
        : undefined;
      const thumbnail =
        input.thumbnailUrl === undefined
          ? undefined
          : input.thumbnailUrl === null
            ? null
            : await resolveDriveFile(input.thumbnailUrl, 'thumbnailUrl', 'image');

      await db.transaction(async (tx) => {
        const now = new Date();
        const working = await loadWorkingSet(tx, batchId, now, { forUpdate: true });
        await reopenIfCompleted(tx, working.batch);
        const entry = findItem(working, itemId);
        assertUnlocked(working, entry);

        const patch: QueueItemPatch = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.topicNumber !== undefined) patch.topicNumber = input.topicNumber;
        if (input.partNumber !== undefined) patch.partNumber = input.partNumber;
        if (input.caption !== undefined) patch.caption = input.caption;
        if (input.hashtags !== undefined) patch.hashtags = input.hashtags;
        if (video) {
          patch.videoFileId = video.id;
          patch.videoFileName = video.name.slice(0, 300);
        }
        if (thumbnail !== undefined) {
          patch.thumbnailFileId = thumbnail?.id ?? null;
          patch.thumbnailFileName = thumbnail?.name.slice(0, 300) ?? null;
        }
        let rescheduled = false;
        if (input.scheduledAt !== undefined) {
          const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
          if (!entry.item.isPaused) assertSchedulable(working, scheduledAt, now);
          patch.scheduledAt = scheduledAt;
          rescheduled = scheduledAt?.getTime() !== entry.item.scheduledAt?.getTime();
        }

        await createItemsRepository(tx).update(itemId, patch);
        // A failed row given a new schedule uploads afresh at that time.
        if (rescheduled) await createPublicationsRepository(tx).deleteFailedForItem(itemId);
      });

      logger.info('Publisher row updated', {
        actorId: ctx.user.id,
        batchId,
        itemId,
        fields: Object.keys(input),
      });
      return loadBatchDetail(db, batchId);
    },

    async delete(ctx: AuthContext, batchId: string, itemId: string): Promise<BatchDetailDto> {
      await db.transaction(async (tx) => {
        const working = await loadWorkingSet(tx, batchId, new Date(), { forUpdate: true });
        await reopenIfCompleted(tx, working.batch);
        assertUnlocked(working, findItem(working, itemId));
        // Other rows keep their schedules (no shifting).
        await createItemsRepository(tx).delete(itemId);
      });

      logger.info('Publisher row deleted', { actorId: ctx.user.id, batchId, itemId });
      return loadBatchDetail(db, batchId);
    },

    /** "Tunda": the row stays in the list but is skipped by the publisher. */
    async pause(ctx: AuthContext, batchId: string, itemId: string): Promise<BatchDetailDto> {
      await db.transaction(async (tx) => {
        const working = await loadWorkingSet(tx, batchId, new Date(), { forUpdate: true });
        await reopenIfCompleted(tx, working.batch);
        const entry = findItem(working, itemId);
        assertUnlocked(working, entry);
        if (!entry.item.isPaused)
          await createItemsRepository(tx).update(itemId, { isPaused: true });
      });

      logger.info('Publisher row paused', { actorId: ctx.user.id, batchId, itemId });
      return loadBatchDetail(db, batchId);
    },

    /** Resumes a paused row; in a scheduled batch it needs a schedule outside the lock window. */
    async resume(
      ctx: AuthContext,
      batchId: string,
      itemId: string,
      input: ResumeItemRequest,
    ): Promise<BatchDetailDto> {
      await db.transaction(async (tx) => {
        const now = new Date();
        const working = await loadWorkingSet(tx, batchId, now, { forUpdate: true });
        await reopenIfCompleted(tx, working.batch);
        const entry = findItem(working, itemId);
        assertUnlocked(working, entry);
        if (!entry.item.isPaused) throw conflict('Baris ini tidak sedang ditunda.');

        const scheduledAt =
          input.scheduledAt === undefined
            ? entry.item.scheduledAt
            : input.scheduledAt === null
              ? null
              : new Date(input.scheduledAt);
        assertSchedulable(working, scheduledAt, now);

        await createItemsRepository(tx).update(itemId, { isPaused: false, scheduledAt });
        await createPublicationsRepository(tx).deleteFailedForItem(itemId);
      });

      logger.info('Publisher row resumed', { actorId: ctx.user.id, batchId, itemId });
      return loadBatchDetail(db, batchId);
    },

    /**
     * "Unggah sekarang": queues the upload of one row to one platform and wakes the
     * worker. Rules: see `manualUploadBlock` (confirmed batch, active row, connected
     * account, not uploaded/uploading, not inside the lock window of a future schedule).
     */
    async publishNow(
      ctx: AuthContext,
      batchId: string,
      itemId: string,
      input: PublishNowRequest,
    ): Promise<BatchDetailDto> {
      if (!publisher) {
        throw conflict(
          'Unggah otomatis sedang nonaktif di server (SOCIAL_PUBLISHER_ENABLED=false).',
        );
      }

      await db.transaction(async (tx) => {
        const now = new Date();
        const working = await loadWorkingSet(tx, batchId, now, { forUpdate: true });
        if (!batchPlatforms(working.batch).includes(input.platform)) {
          throw conflict('Platform ini tidak dipilih untuk ide ini.');
        }
        const entry = findItem(working, itemId);
        const account = await createAccountsRepository(tx).findForBatch(batchId, input.platform);
        const blocked = manualUploadBlock(
          {
            batchStatus: working.batch.status,
            archived: working.batch.archivedAt !== null,
            isPaused: entry.item.isPaused,
            scheduledAt: entry.item.scheduledAt,
            hasVideo: entry.item.videoFileId !== '',
            accountConnected: account?.status === 'connected',
            publicationStatus:
              entry.publications.find((p) => p.platform === input.platform)?.status ?? null,
          },
          working.settings.lockMinutes,
          now,
        );
        if (blocked) throw conflict(blocked);

        const queued = await createPublicationsRepository(tx).queueManual(itemId, input.platform);
        if (!queued) throw conflict('Baris ini sedang atau sudah diunggah.');
      });

      publisher.wake();
      logger.info('Publisher manual upload queued', {
        actorId: ctx.user.id,
        batchId,
        itemId,
        platform: input.platform,
      });
      return loadBatchDetail(db, batchId);
    },
  };
}

export type ItemsService = ReturnType<typeof createItemsService>;

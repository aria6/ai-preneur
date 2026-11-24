import type { Database } from '@ai-preneur/database';
import {
  AVAILABLE_SOCIAL_PLATFORMS,
  extractDriveFolderId,
  SOCIAL_PLATFORM_LABELS,
  type AutoScheduleRequest,
  type BatchDetailDto,
  type BatchSummaryDto,
  type CreateBatchRequest,
  type ReorderItemsRequest,
  type ScanResponse,
  type ScanWarning,
  type SocialPlatform,
  type UpdateBatchRequest,
} from '@ai-preneur/shared';

import { conflict, fieldError } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import type { AuthContext } from '../../iam/index.js';
import {
  buildQueueFromFolder,
  isTextFile,
  type CaptionSource,
  type DriveFileRef,
} from '../domain/filename-parser.js';
import {
  autoSchedule,
  confirmationProblems,
  earliestEditableTime,
  reorderWithSlots,
} from '../domain/queue-rules.js';
import {
  DriveError,
  isDriveFolder,
  type GoogleDriveClient,
} from '../integrations/google-drive.client.js';
import { createAccountsRepository } from '../repositories/accounts.repository.js';
import { createBatchesRepository } from '../repositories/batches.repository.js';
import { createItemsRepository } from '../repositories/items.repository.js';
import { batchPlatforms, toBatchSummary } from '../social.mappers.js';
import {
  assertDraft,
  assertNotCompleted,
  driveToAppError,
  hasUploads,
  loadBatchDetail,
  loadWorkingSet,
} from './batch-context.js';

const THUMBNAIL_FOLDER = /^thumbnails?$/i;
const CAPTION_FOLDER = /^captions?$/i;
/** Parallel caption downloads, to stay well inside Drive's per-user rate limit. */
const CAPTION_DOWNLOAD_CONCURRENCY = 5;

/**
 * Downloads every .txt file of the caption folder. A file that fails (too large, private,
 * timeout) is reported through `errors` instead of failing the whole scan.
 */
async function readCaptionFiles(
  drive: GoogleDriveClient,
  files: readonly DriveFileRef[],
): Promise<CaptionSource> {
  const texts = new Map<string, string>();
  const errors = new Map<string, string>();
  const queue = files.filter(isTextFile);

  async function worker(): Promise<void> {
    for (let file = queue.shift(); file; file = queue.shift()) {
      try {
        texts.set(file.id, await drive.readTextFile(file.id));
      } catch (error) {
        if (!(error instanceof DriveError)) throw error;
        errors.set(file.id, error.message);
      }
    }
  }
  await Promise.all(Array.from({ length: CAPTION_DOWNLOAD_CONCURRENCY }, worker));
  return { files, texts, errors };
}

function assertAvailablePlatforms(platforms: readonly SocialPlatform[]): void {
  const unavailable = platforms.filter(
    (platform) => !AVAILABLE_SOCIAL_PLATFORMS.includes(platform),
  );
  if (unavailable.length > 0) {
    throw fieldError(
      'platforms',
      `${unavailable.map((p) => SOCIAL_PLATFORM_LABELS[p]).join(', ')} belum tersedia (segera hadir).`,
    );
  }
}

function folderIdOrThrow(url: string): string {
  const id = extractDriveFolderId(url);
  if (!id) throw fieldError('driveFolderUrl', 'Link folder Google Drive tidak valid.');
  return id;
}

/** Publisher AIgent batches: one batch per idea, holding its content queue. */
export function createBatchesService(deps: {
  db: Database;
  drive: GoogleDriveClient;
  logger: Logger;
}) {
  const { db, drive, logger } = deps;
  const batches = createBatchesRepository(db);

  return {
    async list(): Promise<BatchSummaryDto[]> {
      const rows = await batches.list();
      const stats = await batches.stats(rows.map((row) => row.id));
      return rows.map((row) => toBatchSummary(row, stats.get(row.id)));
    },

    get(id: string): Promise<BatchDetailDto> {
      return loadBatchDetail(db, id);
    },

    async create(ctx: AuthContext, input: CreateBatchRequest): Promise<BatchDetailDto> {
      assertAvailablePlatforms(input.platforms);
      const id = await db.transaction(async (tx) => {
        const txBatches = createBatchesRepository(tx);
        return txBatches.insert({
          title: input.title,
          ideaNumber: await txBatches.nextIdeaNumber(),
          driveFolderId: folderIdOrThrow(input.driveFolderUrl),
          driveFolderUrl: input.driveFolderUrl,
          platforms: input.platforms,
          createdById: ctx.user.id,
        });
      });
      logger.info('Publisher batch created', { actorId: ctx.user.id, batchId: id });
      return loadBatchDetail(db, id);
    },

    async update(ctx: AuthContext, id: string, input: UpdateBatchRequest): Promise<BatchDetailDto> {
      if (input.platforms) assertAvailablePlatforms(input.platforms);

      await db.transaction(async (tx) => {
        const { batch } = await loadWorkingSet(tx, id, new Date(), { forUpdate: true });
        assertNotCompleted(batch);

        const draftOnly =
          input.driveFolderUrl !== undefined ||
          input.platforms !== undefined ||
          input.ideaNumber !== undefined;
        if (draftOnly) assertDraft(batch, 'Mengubah link folder, IDEA_ID, atau media sosial');

        if (input.platforms) {
          // Deselecting a platform frees its account so it can serve another idea.
          const removed = batchPlatforms(batch).filter(
            (platform) => !input.platforms?.includes(platform),
          );
          const accounts = createAccountsRepository(tx);
          for (const platform of removed) await accounts.deleteForBatch(id, platform);
        }

        await createBatchesRepository(tx).update(id, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.ideaNumber !== undefined ? { ideaNumber: input.ideaNumber } : {}),
          ...(input.platforms !== undefined ? { platforms: input.platforms } : {}),
          ...(input.driveFolderUrl !== undefined
            ? {
                driveFolderUrl: input.driveFolderUrl,
                driveFolderId: folderIdOrThrow(input.driveFolderUrl),
              }
            : {}),
        });
      });

      logger.info('Publisher batch updated', {
        actorId: ctx.user.id,
        batchId: id,
        fields: Object.keys(input),
      });
      return loadBatchDetail(db, id);
    },

    async delete(ctx: AuthContext, id: string): Promise<void> {
      await db.transaction(async (tx) => {
        const working = await loadWorkingSet(tx, id, new Date(), { forUpdate: true });
        assertDraft(working.batch, 'Menghapus batch');
        if (hasUploads(working.items)) {
          throw conflict(
            'Batch ini sudah punya video yang terunggah, sehingga tidak dapat dihapus.',
          );
        }
        await createBatchesRepository(tx).delete(id);
      });
      logger.info('Publisher batch deleted', { actorId: ctx.user.id, batchId: id });
    },

    /**
     * "Generate antrean konten": reads the shared Drive folder and replaces the queue.
     * Draft only, and never once something was uploaded (that history must stay).
     */
    async scan(ctx: AuthContext, id: string): Promise<ScanResponse> {
      const current = await loadWorkingSet(db, id, new Date());
      assertDraft(current.batch, 'Generate antrean');
      if (hasUploads(current.items)) {
        throw conflict(
          'Batch ini sudah punya video yang terunggah, sehingga antrean tidak dapat digenerate ulang.',
        );
      }

      const warnings: ScanWarning[] = [];
      let result: ReturnType<typeof buildQueueFromFolder>;
      try {
        const folder = await drive.getFile(current.batch.driveFolderId);
        if (!isDriveFolder(folder))
          throw fieldError('driveFolderUrl', 'Link tersebut bukan folder Google Drive.');

        const contents = await drive.listFolder(folder.id);
        const thumbnailFolder = contents.folders.find((f) => THUMBNAIL_FOLDER.test(f.name.trim()));
        const thumbnails = thumbnailFolder
          ? (await drive.listFolder(thumbnailFolder.id)).files
          : [];
        if (!thumbnailFolder) {
          warnings.push({
            fileName: 'thumbnail/',
            message: 'Folder thumbnail/ tidak ditemukan; baris dibuat tanpa thumbnail.',
          });
        }
        const captionFolder = contents.folders.find((f) => CAPTION_FOLDER.test(f.name.trim()));
        const captions = captionFolder
          ? await readCaptionFiles(drive, (await drive.listFolder(captionFolder.id)).files)
          : null;
        if (!captionFolder) {
          warnings.push({
            fileName: 'caption/',
            message: 'Folder caption/ tidak ditemukan; caption & hashtag dikosongkan.',
          });
        }
        result = buildQueueFromFolder(
          contents.files,
          thumbnails,
          current.batch.ideaNumber,
          captions,
        );
      } catch (error) {
        throw driveToAppError(error, 'driveFolderUrl');
      }

      if (result.items.length === 0) {
        throw fieldError('driveFolderUrl', 'Tidak ada file video di folder ini.');
      }

      await db.transaction(async (tx) => {
        const locked = await loadWorkingSet(tx, id, new Date(), { forUpdate: true });
        assertDraft(locked.batch, 'Generate antrean');
        if (hasUploads(locked.items)) throw conflict('Batch ini sudah punya video yang terunggah.');

        const items = createItemsRepository(tx);
        await items.deleteByBatch(id);
        await items.insertMany(
          id,
          result.items.map((item) => ({
            ...item,
            scheduledAt: null,
            isPaused: false,
          })),
        );
        await createBatchesRepository(tx).update(id, { ideaNumber: result.ideaNumber });
      });

      logger.info('Publisher queue generated from Drive', {
        actorId: ctx.user.id,
        batchId: id,
        items: result.items.length,
      });
      return {
        batch: await loadBatchDetail(db, id),
        report: { added: result.items.length, warnings: [...warnings, ...result.warnings] },
      };
    },

    async autoSchedule(
      ctx: AuthContext,
      id: string,
      input: AutoScheduleRequest,
    ): Promise<BatchDetailDto> {
      await db.transaction(async (tx) => {
        const now = new Date();
        const working = await loadWorkingSet(tx, id, now, { forUpdate: true });
        assertNotCompleted(working.batch);

        const startAt = new Date(input.startAt);
        if (working.batch.status === 'scheduled') {
          const earliest = earliestEditableTime(working.settings.lockMinutes, now);
          if (startAt < earliest) {
            throw fieldError(
              'startAt',
              `Waktu mulai minimal ${working.settings.lockMinutes} menit dari sekarang.`,
            );
          }
        }

        const assignments = autoSchedule(
          working.items.map(({ item, lockReason }) => ({
            id: item.id,
            scheduledAt: item.scheduledAt,
            isPaused: item.isPaused,
            locked: lockReason !== null,
          })),
          startAt,
          input.intervalMinutes,
        );
        if (assignments.length === 0) throw conflict('Tidak ada baris yang bisa dijadwalkan.');

        const items = createItemsRepository(tx);
        for (const { id: itemId, scheduledAt } of assignments)
          await items.update(itemId, { scheduledAt });
      });

      logger.info('Publisher queue auto-scheduled', { actorId: ctx.user.id, batchId: id });
      return loadBatchDetail(db, id);
    },

    /** Drag & drop. Time slots stay at their positions (see reorderWithSlots). */
    async reorder(
      ctx: AuthContext,
      id: string,
      input: ReorderItemsRequest,
    ): Promise<BatchDetailDto> {
      await db.transaction(async (tx) => {
        const now = new Date();
        const working = await loadWorkingSet(tx, id, now, { forUpdate: true });
        assertNotCompleted(working.batch);

        const result = reorderWithSlots(
          working.items.map(({ item, lockReason }) => ({
            id: item.id,
            scheduledAt: item.scheduledAt,
            isPaused: item.isPaused,
            locked: lockReason !== null,
          })),
          input.itemIds,
          {
            batchScheduled: working.batch.status === 'scheduled',
            earliestAllowed: earliestEditableTime(working.settings.lockMinutes, now),
          },
        );
        if (!result.ok) throw conflict(result.message);

        const items = createItemsRepository(tx);
        for (const update of result.updates) {
          await items.update(update.id, {
            position: update.position,
            scheduledAt: update.scheduledAt,
          });
        }
      });

      logger.info('Publisher queue reordered', { actorId: ctx.user.id, batchId: id });
      return loadBatchDetail(db, id);
    },

    /** Draft → Terjadwal. Nothing is uploaded now; each row uploads at its own schedule. */
    async confirm(ctx: AuthContext, id: string): Promise<BatchDetailDto> {
      await db.transaction(async (tx) => {
        const now = new Date();
        const working = await loadWorkingSet(tx, id, now, { forUpdate: true });
        assertDraft(working.batch, 'Konfirmasi jadwal');

        const accounts = await createAccountsRepository(tx).listByBatch(id);
        const problems = confirmationProblems({
          items: working.items
            .filter((entry) => entry.lockReason === null)
            .map(({ item }) => ({
              title: item.title,
              isPaused: item.isPaused,
              scheduledAt: item.scheduledAt,
            })),
          platforms: batchPlatforms(working.batch).map((p) => SOCIAL_PLATFORM_LABELS[p]),
          connectedPlatforms: accounts
            .filter((account) => account.status === 'connected')
            .map((account) => SOCIAL_PLATFORM_LABELS[account.platform]),
          minConfirmLeadMinutes: working.settings.minConfirmLeadMinutes,
          now,
        });
        if (problems.length > 0) throw conflict('Batch belum bisa dikonfirmasi.', problems);

        await createBatchesRepository(tx).update(id, { status: 'scheduled', confirmedAt: now });
      });

      logger.info('Publisher batch confirmed', { actorId: ctx.user.id, batchId: id });
      return loadBatchDetail(db, id);
    },

    /** Terjadwal → Draft. Rows already uploaded stay recorded. */
    async cancelSchedule(ctx: AuthContext, id: string): Promise<BatchDetailDto> {
      await db.transaction(async (tx) => {
        const working = await loadWorkingSet(tx, id, new Date(), { forUpdate: true });
        if (working.batch.status !== 'scheduled')
          throw conflict('Batch ini tidak sedang terjadwal.');
        await createBatchesRepository(tx).update(id, { status: 'draft', confirmedAt: null });
      });

      logger.info('Publisher batch schedule cancelled', { actorId: ctx.user.id, batchId: id });
      return loadBatchDetail(db, id);
    },
  };
}

export type BatchesService = ReturnType<typeof createBatchesService>;

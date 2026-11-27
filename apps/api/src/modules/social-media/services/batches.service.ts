import { isUniqueViolation, type Database } from '@ai-preneur/database';
import {
  AVAILABLE_SOCIAL_PLATFORMS,
  extractDriveFolderId,
  SOCIAL_PLATFORM_LABELS,
  type AutoScheduleRequest,
  type BatchDetailDto,
  type BatchSummaryDto,
  type CreateBatchRequest,
  type IdeaListFilter,
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
  assertNotArchived,
  reopenIfCompleted,
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

const ideaNumberTaken = (ideaNumber: number, title?: string): string =>
  title
    ? `IDEA_ID ${ideaNumber} sudah dipakai ide "${title}". Setiap ide harus punya IDEA_ID sendiri.`
    : `IDEA_ID ${ideaNumber} sudah dipakai ide lain. Setiap ide harus punya IDEA_ID sendiri.`;

/** Scan refused: the file names carry an IDEA_ID that belongs to another idea. */
const ideaNumberFromFilesTaken = (ideaNumber: number, title?: string) =>
  conflict(
    `Nama file di folder ini memakai IDEA_ID ${ideaNumber}, padahal ${
      title ? `IDEA_ID itu sudah dipakai ide "${title}"` : 'IDEA_ID itu sudah dipakai ide lain'
    }. Ganti awalan nama file (mis. ${ideaNumber}.1-… → <IDEA_ID baru>.1-…) atau ubah IDEA_ID ide tersebut, lalu generate lagi.`,
  );

/** Publisher AIgent batches: one batch per idea, holding its content queue. */
export function createBatchesService(deps: {
  db: Database;
  drive: GoogleDriveClient;
  logger: Logger;
}) {
  const { db, drive, logger } = deps;
  const batches = createBatchesRepository(db);

  return {
    async list(filter: IdeaListFilter): Promise<BatchSummaryDto[]> {
      const rows = await batches.list(filter);
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
        await txBatches.lockIdeaNumbers();
        return txBatches.insert({
          title: input.title,
          description: input.description,
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

      try {
        await db.transaction(async (tx) => {
          const { batch } = await loadWorkingSet(tx, id, new Date(), { forUpdate: true });
          assertNotArchived(batch);

          // Title and description can change in any status; the rest is Draft only
          // (a Selesai idea becomes Draft again).
          const draftOnly =
            input.driveFolderUrl !== undefined ||
            input.platforms !== undefined ||
            input.ideaNumber !== undefined;
          if (draftOnly) {
            assertDraft(
              await reopenIfCompleted(tx, batch),
              'Mengubah link folder, IDEA_ID, atau media sosial',
            );
          }

          const txBatches = createBatchesRepository(tx);
          if (input.ideaNumber !== undefined && input.ideaNumber !== batch.ideaNumber) {
            await txBatches.lockIdeaNumbers();
            const owner = await txBatches.findByIdeaNumber(input.ideaNumber, id);
            if (owner)
              throw fieldError('ideaNumber', ideaNumberTaken(input.ideaNumber, owner.title));
          }

          if (input.platforms) {
            // Deselecting a platform frees its account so it can serve another idea.
            const removed = batchPlatforms(batch).filter(
              (platform) => !input.platforms?.includes(platform),
            );
            const accounts = createAccountsRepository(tx);
            for (const platform of removed) await accounts.deleteForBatch(id, platform);
          }

          await txBatches.update(id, {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
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
      } catch (error) {
        if (isUniqueViolation(error) && input.ideaNumber !== undefined) {
          throw fieldError('ideaNumber', ideaNumberTaken(input.ideaNumber));
        }
        throw error;
      }

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
        assertNotArchived(working.batch);
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
     * "Generate antrean konten": reads the shared Drive folder. While nothing has been
     * uploaded it rebuilds the queue; afterwards it only appends the folder's videos that
     * are not in the queue yet (by Drive file ID), leaving every existing row untouched.
     * Draft or Selesai (which becomes Draft again).
     */
    async scan(ctx: AuthContext, id: string): Promise<ScanResponse> {
      const current = await loadWorkingSet(db, id, new Date());
      assertNotArchived(current.batch);
      if (current.batch.status !== 'completed') assertDraft(current.batch, 'Generate antrean');

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

      let outcome: { mode: 'replace' | 'append'; added: number; alreadyQueued: number } = {
        mode: 'replace',
        added: 0,
        alreadyQueued: 0,
      };
      let reportWarnings = result.warnings;
      try {
        await db.transaction(async (tx) => {
          const locked = await loadWorkingSet(tx, id, new Date(), { forUpdate: true });
          assertDraft(await reopenIfCompleted(tx, locked.batch), 'Generate antrean');

          // The IDEA_ID read from the file names must not belong to another idea.
          const txBatches = createBatchesRepository(tx);
          if (result.ideaNumber !== locked.batch.ideaNumber) {
            await txBatches.lockIdeaNumbers();
            const owner = await txBatches.findByIdeaNumber(result.ideaNumber, id);
            if (owner) throw ideaNumberFromFilesTaken(result.ideaNumber, owner.title);
          }

          const items = createItemsRepository(tx);
          if (!hasUploads(locked.items)) {
            await items.deleteByBatch(id);
            await items.insertMany(
              id,
              result.items.map((item) => ({ ...item, scheduledAt: null, isPaused: false })),
            );
            outcome = { mode: 'replace', added: result.items.length, alreadyQueued: 0 };
          } else {
            // Uploads exist: their rows (and every other row) stay as they are.
            const queued = new Set(locked.items.map(({ item }) => item.videoFileId));
            const fresh = result.items.filter((item) => !queued.has(item.videoFileId));
            const firstPosition =
              Math.max(-1, ...locked.items.map(({ item }) => item.position)) + 1;
            await items.insertMany(
              id,
              fresh.map((item, index) => ({
                ...item,
                position: firstPosition + index,
                scheduledAt: null,
                isPaused: false,
              })),
            );
            outcome = {
              mode: 'append',
              added: fresh.length,
              alreadyQueued: result.items.length - fresh.length,
            };
            // Notes about videos already in the queue are old news.
            const oldNames = new Set(
              result.items
                .filter((item) => queued.has(item.videoFileId))
                .map((item) => item.videoFileName),
            );
            reportWarnings = result.warnings.filter((warning) => !oldNames.has(warning.fileName));
          }
          await txBatches.update(id, { ideaNumber: result.ideaNumber });
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw ideaNumberFromFilesTaken(result.ideaNumber);
        throw error;
      }

      logger.info('Publisher queue generated from Drive', {
        actorId: ctx.user.id,
        batchId: id,
        ...outcome,
      });
      return {
        batch: await loadBatchDetail(db, id),
        report: { ...outcome, warnings: [...warnings, ...reportWarnings] },
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
        await reopenIfCompleted(tx, working.batch);

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
        await reopenIfCompleted(tx, working.batch);

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
        assertNotArchived(working.batch);
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
        const uploading = working.items.some((entry) =>
          entry.publications.some((p) => p.status === 'queued' || p.status === 'processing'),
        );
        if (uploading) {
          throw conflict('Ada video yang sedang diunggah. Tunggu sampai selesai, lalu coba lagi.');
        }
        await createBatchesRepository(tx).update(id, { status: 'draft', confirmedAt: null });
      });

      logger.info('Publisher batch schedule cancelled', { actorId: ctx.user.id, batchId: id });
      return loadBatchDetail(db, id);
    },

    /**
     * Archives an idea: read-only, nothing uploads, listed under "Arsip". Only Draft or
     * Selesai (a scheduled idea would silently stop uploading) and never mid-upload.
     */
    async archive(ctx: AuthContext, id: string): Promise<BatchDetailDto> {
      await db.transaction(async (tx) => {
        const working = await loadWorkingSet(tx, id, new Date(), { forUpdate: true });
        if (working.batch.archivedAt) throw conflict('Ide ini sudah diarsip.');
        if (working.batch.status === 'scheduled') {
          throw conflict(
            'Hanya ide berstatus Draft atau Selesai yang bisa diarsip. Batalkan jadwal terlebih dahulu.',
          );
        }
        const uploading = working.items.some((entry) =>
          entry.publications.some((p) => p.status === 'queued' || p.status === 'processing'),
        );
        if (uploading) {
          throw conflict('Ada video yang sedang diunggah. Tunggu sampai selesai, lalu coba lagi.');
        }
        await createBatchesRepository(tx).update(id, { archivedAt: new Date() });
      });
      logger.info('Publisher idea archived', { actorId: ctx.user.id, batchId: id });
      return loadBatchDetail(db, id);
    },

    /** Back to the active list, in the status it had (Draft or Selesai). */
    async unarchive(ctx: AuthContext, id: string): Promise<BatchDetailDto> {
      await db.transaction(async (tx) => {
        const working = await loadWorkingSet(tx, id, new Date(), { forUpdate: true });
        if (!working.batch.archivedAt) throw conflict('Ide ini tidak sedang diarsip.');
        await createBatchesRepository(tx).update(id, { archivedAt: null });
      });
      logger.info('Publisher idea unarchived', { actorId: ctx.user.id, batchId: id });
      return loadBatchDetail(db, id);
    },
  };
}

export type BatchesService = ReturnType<typeof createBatchesService>;

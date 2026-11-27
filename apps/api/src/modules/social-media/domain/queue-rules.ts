/**
 * Queue rules: row locking, reordering with fixed time slots, auto-scheduling and
 * the confirmation checks. Pure functions — the services feed them data and
 * enforce the result, so the same rules apply to every endpoint.
 */
import type { BatchStatus, ItemLockReason, PublicationStatus } from '@ai-preneur/shared';

const MINUTE = 60_000;

export interface LockInput {
  batchStatus: BatchStatus;
  isPaused: boolean;
  scheduledAt: Date | null;
  publicationStatuses: readonly PublicationStatus[];
}

/**
 * A row is read-only once it is (being) uploaded anywhere, or — while the batch is
 * scheduled — once its own upload is closer than `lockMinutes`. Paused rows never
 * upload, so they are not time-locked.
 */
export function computeItemLock(
  input: LockInput,
  lockMinutes: number,
  now: Date,
): ItemLockReason | null {
  if (input.publicationStatuses.includes('published')) return 'published';
  if (
    input.publicationStatuses.includes('processing') ||
    input.publicationStatuses.includes('queued')
  ) {
    return 'processing';
  }
  if (
    input.batchStatus === 'scheduled' &&
    !input.isPaused &&
    input.scheduledAt !== null &&
    input.scheduledAt.getTime() - now.getTime() < lockMinutes * MINUTE
  ) {
    return 'imminent';
  }
  return null;
}

export interface ManualUploadInput {
  batchStatus: BatchStatus;
  /** Archived ideas never upload. */
  archived: boolean;
  isPaused: boolean;
  scheduledAt: Date | null;
  hasVideo: boolean;
  accountConnected: boolean;
  /** This row's publication on the platform, if any. */
  publicationStatus: PublicationStatus | null;
}

/**
 * "Unggah sekarang" for one row on one platform. Returns null when allowed, else the
 * reason. Allowed once the batch is confirmed (Terjadwal/Selesai), for an active row
 * with a video and a connected account that is not uploaded or uploading on that
 * platform. A future schedule closer than `lockMinutes` locks it (like every edit);
 * a past schedule does not — that is the failed/missed row this feature is for.
 */
export function manualUploadBlock(
  input: ManualUploadInput,
  lockMinutes: number,
  now: Date,
): string | null {
  if (input.archived) return 'Ide ini diarsip. Buka arsip dulu untuk mengunggah.';
  if (input.batchStatus === 'draft') return 'Konfirmasi jadwal dulu untuk mengunggah manual.';
  if (input.publicationStatus === 'published') return 'Sudah terunggah.';
  if (input.publicationStatus === 'queued' || input.publicationStatus === 'processing') {
    return 'Sedang diunggah.';
  }
  if (input.isPaused) return 'Baris ditunda. Lanjutkan dulu untuk mengunggah.';
  if (!input.hasVideo) return 'Baris ini belum punya video.';
  if (!input.accountConnected) return 'Akun platform ini belum terhubung atau bermasalah.';
  if (input.scheduledAt) {
    const untilSchedule = input.scheduledAt.getTime() - now.getTime();
    if (untilSchedule >= 0 && untilSchedule < lockMinutes * MINUTE) {
      return `Jadwal unggah kurang dari ${lockMinutes} menit lagi; baris terkunci.`;
    }
  }
  return null;
}

/**
 * A row never attempted on a platform whose schedule lies before the batch's
 * confirmation (e.g. the platform was added later). The worker skips it; only a
 * manual upload sends it.
 */
export function isMissedUpload(
  scheduledAt: Date | null,
  confirmedAt: Date | null,
  publicationStatus: PublicationStatus | null,
): boolean {
  return (
    publicationStatus === null &&
    scheduledAt !== null &&
    confirmedAt !== null &&
    scheduledAt.getTime() < confirmedAt.getTime()
  );
}

/** Earliest moment a new or edited schedule may point to while a batch is scheduled. */
export function earliestEditableTime(lockMinutes: number, now: Date): Date {
  return new Date(now.getTime() + lockMinutes * MINUTE);
}

export interface SlotItem {
  id: string;
  scheduledAt: Date | null;
  isPaused: boolean;
  locked: boolean;
}

export interface SlotUpdate {
  id: string;
  position: number;
  scheduledAt: Date | null;
}

export type ReorderResult = { ok: true; updates: SlotUpdate[] } | { ok: false; message: string };

/**
 * Reorders the queue while time slots stay where they are (option A): the row
 * that lands at index i takes the schedule that index i had before.
 * Locked rows must keep their index, so their own time is unchanged.
 *
 * When the batch is scheduled, an active (non-paused) row may only receive a slot
 * that is set and not inside the lock window — otherwise a drag could make a row
 * upload almost immediately.
 */
export function reorderWithSlots(
  current: readonly SlotItem[],
  newOrderIds: readonly string[],
  options: { batchScheduled: boolean; earliestAllowed: Date },
): ReorderResult {
  const byId = new Map(current.map((item) => [item.id, item]));
  if (newOrderIds.length !== current.length || new Set(newOrderIds).size !== newOrderIds.length) {
    return { ok: false, message: 'Urutan tidak lengkap. Muat ulang halaman lalu coba lagi.' };
  }
  if (newOrderIds.some((id) => !byId.has(id))) {
    return {
      ok: false,
      message: 'Urutan berisi baris yang tidak dikenal. Muat ulang halaman lalu coba lagi.',
    };
  }

  const updates: SlotUpdate[] = [];
  for (let index = 0; index < newOrderIds.length; index += 1) {
    const item = byId.get(newOrderIds[index] ?? '');
    const slot = current[index];
    if (!item || !slot) return { ok: false, message: 'Urutan tidak valid.' };

    if (item.locked && current[index]?.id !== item.id) {
      return { ok: false, message: 'Baris yang terkunci tidak dapat dipindahkan.' };
    }

    const scheduledAt = slot.scheduledAt;
    const timeChanges = (scheduledAt?.getTime() ?? null) !== (item.scheduledAt?.getTime() ?? null);
    if (options.batchScheduled && !item.isPaused && timeChanges) {
      if (scheduledAt === null) {
        return {
          ok: false,
          message: `Slot posisi ${index + 1} belum punya jadwal; baris aktif tidak dapat dipindahkan ke sana.`,
        };
      }
      if (scheduledAt < options.earliestAllowed) {
        return {
          ok: false,
          message: `Jadwal slot posisi ${index + 1} terlalu dekat; baris aktif tidak dapat dipindahkan ke sana.`,
        };
      }
    }

    updates.push({ id: item.id, position: index, scheduledAt });
  }
  return { ok: true, updates };
}

/**
 * "Jadwalkan semua": editable, non-paused rows get startAt, startAt + interval, …
 * in queue order. Locked and paused rows keep their schedule.
 */
export function autoSchedule(
  items: readonly SlotItem[],
  startAt: Date,
  intervalMinutes: number,
): { id: string; scheduledAt: Date }[] {
  let slot = 0;
  return items.flatMap((item) => {
    if (item.locked || item.isPaused) return [];
    const scheduledAt = new Date(startAt.getTime() + slot * intervalMinutes * MINUTE);
    slot += 1;
    return [{ id: item.id, scheduledAt }];
  });
}

export interface ConfirmCheckItem {
  title: string;
  isPaused: boolean;
  scheduledAt: Date | null;
}

/** Returns every reason the batch cannot be confirmed yet (empty = OK). */
export function confirmationProblems(input: {
  items: readonly ConfirmCheckItem[];
  platforms: readonly string[];
  connectedPlatforms: readonly string[];
  minConfirmLeadMinutes: number;
  now: Date;
}): string[] {
  const problems: string[] = [];
  const active = input.items.filter((item) => !item.isPaused);

  if (input.platforms.length === 0) problems.push('Pilih minimal satu media sosial.');
  for (const platform of input.platforms) {
    if (!input.connectedPlatforms.includes(platform)) {
      problems.push(`Akun ${platform} untuk ide ini belum terhubung.`);
    }
  }

  if (active.length === 0) problems.push('Antrean belum berisi video aktif.');

  const unscheduled = active.filter((item) => item.scheduledAt === null);
  if (unscheduled.length > 0) {
    problems.push(`${unscheduled.length} baris belum punya jadwal unggah.`);
  }

  const times = active.flatMap((item) => (item.scheduledAt ? [item.scheduledAt.getTime()] : []));
  if (times.length > 0) {
    const earliest = Math.min(...times);
    const minimum = input.now.getTime() + input.minConfirmLeadMinutes * MINUTE;
    if (earliest < minimum) {
      problems.push(
        `Jadwal konten pertama minimal ${input.minConfirmLeadMinutes} menit dari sekarang.`,
      );
    }
  }
  return problems;
}

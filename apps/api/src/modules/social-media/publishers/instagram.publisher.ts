import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { z } from 'zod';

import type { Logger } from '../../../core/logger.js';
import { DriveError, type GoogleDriveClient } from '../integrations/google-drive.client.js';
import {
  createReelsContainer,
  getContainerStatus,
  getMediaPermalink,
  InstagramApiError,
  listRecentMedia,
  publishContainer,
  refreshLongLivedToken,
  uploadReelsVideo,
} from '../integrations/instagram.client.js';
import {
  PublishError,
  type PlatformPublisher,
  type PublishHooks,
  type PublishJob,
  type PublishResult,
  type RecoveryContext,
  type RecoveryOutcome,
} from './publisher.js';

/** Instagram's caption limit (hashtags included). */
const CAPTION_MAX = 2200;
/** Upper bound for a downloaded video; Instagram rejects anything bigger anyway. */
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const STATUS_POLL_INTERVAL_MS = 10_000;
const STATUS_POLL_TIMEOUT_MS = 15 * 60_000;

export const instagramCredentialsSchema = z.object({ accessToken: z.string().min(1) });
export type InstagramCredentials = z.infer<typeof instagramCredentialsSchema>;

export function parseInstagramCredentials(credentials: unknown): InstagramCredentials {
  const parsed = instagramCredentialsSchema.safeParse(credentials);
  if (!parsed.success) {
    throw new PublishError('Kredensial Instagram tidak lengkap. Hubungkan ulang akun.', {
      tokenInvalid: true,
    });
  }
  return parsed.data;
}

/** Caption + hashtag block, cut so the whole text fits Instagram's limit. */
export function buildInstagramCaption(caption: string, hashtags: readonly string[]): string {
  const tags = hashtags.map((tag) => `#${tag}`).join(' ');
  const text = caption.trim();
  if (!tags) return text.slice(0, CAPTION_MAX);
  if (!text) return tags.slice(0, CAPTION_MAX);
  const room = CAPTION_MAX - tags.length - 2;
  return room > 0 ? `${text.slice(0, room).trimEnd()}\n\n${tags}` : tags.slice(0, CAPTION_MAX);
}

/** Direct download link of a public Drive image, fetchable by Instagram's servers. */
function driveCoverUrl(fileId: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
}

function toPublishError(error: unknown): unknown {
  if (error instanceof InstagramApiError) {
    return new PublishError(error.message, {
      retryable: error.retryable,
      tokenInvalid: error.tokenInvalid,
    });
  }
  if (error instanceof DriveError) {
    return new PublishError(`Video tidak dapat diunduh dari Google Drive: ${error.message}`, {
      retryable: error.kind === 'unavailable',
    });
  }
  return error;
}

async function waitUntilProcessed(
  accessToken: string,
  containerId: string,
  signal: AbortSignal,
): Promise<{ ok: true } | { ok: false; detail: string | null }> {
  const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS;
  for (;;) {
    const status = await getContainerStatus(accessToken, containerId);
    if (status.code === 'FINISHED') return { ok: true };
    if (status.code === 'ERROR') return { ok: false, detail: status.detail };
    if (status.code === 'EXPIRED') {
      throw new PublishError('Kontainer Instagram kedaluwarsa sebelum dipublikasikan.', {
        retryable: true,
      });
    }
    if (status.code === 'PUBLISHED') {
      // Never expected for a fresh container; refuse to publish twice.
      throw new PublishError('Kontainer ini sudah dipublikasikan sebelumnya.');
    }
    if (Date.now() > deadline) {
      throw new PublishError('Instagram terlalu lama memproses video.', { retryable: true });
    }
    await sleep(STATUS_POLL_INTERVAL_MS, undefined, { signal });
  }
}

export const WARNING_NO_COVER =
  'Video terunggah tanpa cover: Instagram tidak bisa mengambil thumbnail dari Google Drive. Pastikan file thumbnail dibagikan "Siapa saja yang memiliki link" dan berformat JPG/PNG, lalu ganti cover langsung di aplikasi Instagram bila perlu.';
export const WARNING_NO_LINK =
  'Video sudah tayang di Instagram, tetapi link-nya tidak dapat diambil. Periksa profil Instagram untuk memastikan.';

const normalizeSpaces = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Same text, ignoring whitespace differences Instagram may introduce. */
function sameCaption(a: string, b: string): boolean {
  return normalizeSpaces(a) === normalizeSpaces(b);
}

/**
 * Checks a container whose publish answer was lost. When it was published, looks
 * for the post among the account's latest media (same caption, not older than the
 * attempt) to recover its ID and link.
 */
async function recoverContainer(
  accessToken: string,
  context: RecoveryContext,
): Promise<RecoveryOutcome> {
  let published: boolean;
  try {
    published = (await getContainerStatus(accessToken, context.containerId)).code === 'PUBLISHED';
  } catch {
    return { state: 'unknown' };
  }
  if (!published) return { state: 'not_published' };

  const caption = buildInstagramCaption(context.caption, context.hashtags);
  const earliest = context.since.getTime() - 5 * 60_000; // clock skew margin
  try {
    const media = await listRecentMedia(accessToken, context.externalAccountId);
    const match = media.find(
      (entry) =>
        sameCaption(entry.caption, caption) &&
        (entry.timestamp === null || entry.timestamp.getTime() >= earliest),
    );
    if (match) {
      return {
        state: 'published',
        result: {
          externalMediaId: match.id,
          externalUrl: match.permalink,
          warning: match.permalink ? null : WARNING_NO_LINK,
        },
      };
    }
  } catch {
    // fall through: published, but the post could not be identified
  }
  return {
    state: 'published',
    // The container ID stands in for the unknown media ID.
    result: { externalMediaId: context.containerId, externalUrl: null, warning: WARNING_NO_LINK },
  };
}

function joinWarnings(...warnings: (string | false | null | undefined)[]): string | null {
  const list = warnings.filter((warning): warning is string => Boolean(warning));
  return list.length > 0 ? list.join(' ') : null;
}

async function uploadToContainer(input: {
  job: PublishJob;
  hooks: PublishHooks;
  accessToken: string;
  caption: string;
  coverUrl: string | undefined;
  filePath: string;
  fileSize: number;
}): Promise<{ ok: true; containerId: string } | { ok: false; detail: string | null }> {
  const containerId = await createReelsContainer({
    accessToken: input.accessToken,
    igUserId: input.job.externalAccountId,
    caption: input.caption,
    coverUrl: input.coverUrl,
  });
  await input.hooks.onContainerCreated(containerId);
  await uploadReelsVideo({
    accessToken: input.accessToken,
    containerId,
    filePath: input.filePath,
    fileSize: input.fileSize,
    signal: input.hooks.signal,
  });
  const processed = await waitUntilProcessed(input.accessToken, containerId, input.hooks.signal);
  return processed.ok ? { ok: true, containerId } : processed;
}

/**
 * Instagram Reels publisher (Instagram API with Instagram Login):
 * Drive → temp file → resumable container → upload → wait FINISHED → publish → permalink.
 */
export function createInstagramPublisher(deps: {
  drive: GoogleDriveClient;
  logger: Logger;
  tempDir: string;
}): PlatformPublisher {
  const { drive, logger, tempDir } = deps;

  async function publish(job: PublishJob, hooks: PublishHooks): Promise<PublishResult> {
    const { accessToken } = parseInstagramCredentials(job.credentials);
    if (!job.videoFileId) throw new PublishError('Baris ini belum punya video.');

    const attemptStartedAt = new Date();
    await mkdir(tempDir, { recursive: true });
    const filePath = join(tempDir, `${randomUUID()}.mp4`);

    try {
      const fileSize = await drive.downloadToFile(job.videoFileId, filePath, {
        maxBytes: MAX_VIDEO_BYTES,
        signal: hooks.signal,
      });
      const caption = buildInstagramCaption(job.caption, job.hashtags);
      const coverUrl = job.thumbnailFileId ? driveCoverUrl(job.thumbnailFileId) : undefined;

      let uploaded = await uploadToContainer({
        job,
        hooks,
        accessToken,
        caption,
        coverUrl,
        filePath,
        fileSize,
      });
      let coverDropped = false;
      if (!uploaded.ok && coverUrl) {
        coverDropped = true;
        // A cover Instagram cannot fetch fails the whole container: retry without it.
        logger.warn('Instagram container failed with a cover; retrying without it', {
          itemId: job.itemId,
          detail: uploaded.detail,
        });
        uploaded = await uploadToContainer({
          job,
          hooks,
          accessToken,
          caption,
          coverUrl: undefined,
          filePath,
          fileSize,
        });
      }
      if (!uploaded.ok) {
        throw new PublishError(
          `Instagram gagal memproses video${uploaded.detail ? ` (${uploaded.detail})` : ''}. Periksa format video (MP4/MOV, H.264, rasio 9:16, 3 detik–15 menit).`,
        );
      }

      await hooks.onPublishRequested();
      let mediaId: string;
      try {
        mediaId = await publishContainer(accessToken, job.externalAccountId, uploaded.containerId);
      } catch (error) {
        // The request may have reached Instagram even though the answer got lost.
        const outcome = await recoverContainer(accessToken, {
          containerId: uploaded.containerId,
          externalAccountId: job.externalAccountId,
          caption: job.caption,
          hashtags: job.hashtags,
          since: attemptStartedAt,
        });
        if (outcome.state === 'published') {
          return {
            ...outcome.result,
            warning: joinWarnings(coverDropped && WARNING_NO_COVER, outcome.result.warning),
          };
        }
        if (outcome.state === 'not_published') throw error; // safe to try again
        throw new PublishError(
          'Status publikasi tidak pasti (koneksi terputus saat memublikasikan). Periksa Instagram sebelum mencoba lagi.',
        );
      }

      const permalink = await getMediaPermalink(accessToken, mediaId);
      return {
        externalMediaId: mediaId,
        externalUrl: permalink,
        warning: joinWarnings(coverDropped && WARNING_NO_COVER, !permalink && WARNING_NO_LINK),
      };
    } catch (error) {
      throw toPublishError(error);
    } finally {
      await rm(filePath, { force: true }).catch(() => undefined);
    }
  }

  return {
    platform: 'instagram',
    publish,
    async recover(credentials, context) {
      const { accessToken } = parseInstagramCredentials(credentials);
      return recoverContainer(accessToken, context);
    },
    async refreshCredentials(credentials) {
      const { accessToken } = parseInstagramCredentials(credentials);
      try {
        const refreshed = await refreshLongLivedToken(accessToken);
        return {
          credentials: { accessToken: refreshed.accessToken } satisfies InstagramCredentials,
          expiresAt: refreshed.expiresAt,
        };
      } catch (error) {
        throw toPublishError(error);
      }
    },
  };
}

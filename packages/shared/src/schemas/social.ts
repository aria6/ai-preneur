import { z } from 'zod';

// ---- Platforms -------------------------------------------------------------------

export const SOCIAL_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'youtube'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABELS: Readonly<Record<SocialPlatform, string>> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook Reels',
  youtube: 'YouTube Shorts',
};

/** Platforms whose account connection and publishing are implemented. Others are "segera hadir". */
export const AVAILABLE_SOCIAL_PLATFORMS: readonly SocialPlatform[] = ['instagram'];

export const socialPlatformSchema = z.enum(SOCIAL_PLATFORMS, { error: 'Platform tidak dikenal' });

// ---- Google Drive links ------------------------------------------------------------

const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * Splits an `https://drive.google.com/...` link into path and query.
 * Regex-based on purpose: this package must not depend on DOM or Node globals.
 */
function splitDriveUrl(value: string): { path: string; query: string } | null {
  const match = /^https:\/\/drive\.google\.com(\/[^?#]*)?(?:\?([^#]*))?(?:#.*)?$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  return { path: match[1] ?? '/', query: match[2] ?? '' };
}

function queryParam(query: string, name: string): string | null {
  for (const pair of query.split('&')) {
    const [key, raw = ''] = pair.split('=');
    if (key === name) return raw;
  }
  return null;
}

/** Folder ID from `https://drive.google.com/drive/(u/N/)folders/<ID>` or `…/open?id=<ID>`. */
export function extractDriveFolderId(value: string): string | null {
  const url = splitDriveUrl(value);
  if (!url) return null;
  const id = /\/folders\/([A-Za-z0-9_-]+)/.exec(url.path)?.[1] ?? queryParam(url.query, 'id');
  return id && DRIVE_ID.test(id) ? id : null;
}

/** File ID from `https://drive.google.com/file/d/<ID>/…`, `…/open?id=<ID>` or `…/uc?id=<ID>`. */
export function extractDriveFileId(value: string): string | null {
  const url = splitDriveUrl(value);
  if (!url) return null;
  const id = /\/file\/d\/([A-Za-z0-9_-]+)/.exec(url.path)?.[1] ?? queryParam(url.query, 'id');
  return id && DRIVE_ID.test(id) ? id : null;
}

const driveFolderUrlSchema = z
  .string({ error: 'Link folder Google Drive wajib diisi' })
  .trim()
  .min(1, 'Link folder Google Drive wajib diisi')
  .max(500, 'Link terlalu panjang')
  .refine((value) => extractDriveFolderId(value) !== null, {
    message: 'Gunakan link folder Google Drive, contoh: https://drive.google.com/drive/folders/…',
  });

const driveFileUrlSchema = z
  .string()
  .trim()
  .max(500, 'Link terlalu panjang')
  .refine((value) => extractDriveFileId(value) !== null, {
    message: 'Gunakan link file Google Drive, contoh: https://drive.google.com/file/d/…/view',
  });

// ---- Field schemas -----------------------------------------------------------------

const isoDateTimeSchema = z.iso.datetime({
  offset: true,
  error: 'Format tanggal/waktu tidak valid',
});

const hashtagSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^#+/, ''))
  .pipe(
    z
      .string()
      .min(1, 'Hashtag kosong')
      .max(100, 'Hashtag terlalu panjang')
      .regex(/^[\p{L}\p{N}_]+$/u, 'Hashtag hanya boleh berisi huruf, angka, dan garis bawah'),
  );

/** Instagram allows at most 30 hashtags per post. Duplicates (case-insensitive) are removed. */
export const hashtagsSchema = z
  .array(hashtagSchema)
  .max(30, 'Maksimal 30 hashtag')
  .transform((tags) => {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

/** Instagram caption limit. */
export const captionSchema = z.string().max(2200, 'Caption maksimal 2.200 karakter');

const itemTitleSchema = z
  .string({ error: 'Judul wajib diisi' })
  .trim()
  .min(1, 'Judul wajib diisi')
  .max(200, 'Judul maksimal 200 karakter');

const topicNumberSchema = z.number().int().min(0).max(9999);
const partNumberSchema = z.number().int().min(1).max(99).nullable();

// ---- Settings ----------------------------------------------------------------------

export const socialSettingsSchema = z.object({
  /** Rows are locked once their schedule is closer than this. */
  lockMinutes: z.number().int(),
  /** The first scheduled video must be at least this far away when confirming a batch. */
  minConfirmLeadMinutes: z.number().int(),
});
export type SocialSettings = z.infer<typeof socialSettingsSchema>;

export const updateSocialSettingsRequestSchema = z
  .object({
    lockMinutes: z
      .number({ error: 'Wajib diisi' })
      .int('Harus bilangan bulat')
      .min(5, 'Minimal 5 menit')
      .max(1440, 'Maksimal 1.440 menit (24 jam)'),
    minConfirmLeadMinutes: z
      .number({ error: 'Wajib diisi' })
      .int('Harus bilangan bulat')
      .min(5, 'Minimal 5 menit')
      .max(10080, 'Maksimal 10.080 menit (7 hari)'),
  })
  .refine((data) => data.minConfirmLeadMinutes >= data.lockMinutes, {
    message: 'Jeda minimal konfirmasi tidak boleh lebih kecil dari batas kunci edit',
    path: ['minConfirmLeadMinutes'],
  });
export type UpdateSocialSettingsRequest = z.infer<typeof updateSocialSettingsRequestSchema>;

export const socialSettingsResponseSchema = z.object({ settings: socialSettingsSchema });

// ---- DTOs --------------------------------------------------------------------------

export const BATCH_STATUSES = ['draft', 'scheduled', 'completed'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const PUBLICATION_STATUSES = ['processing', 'published', 'failed'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** Why a queue row can no longer be edited. */
export const ITEM_LOCK_REASONS = ['published', 'processing', 'imminent'] as const;
export type ItemLockReason = (typeof ITEM_LOCK_REASONS)[number];

export const socialAccountSchema = z.object({
  platform: socialPlatformSchema,
  username: z.string().nullable(),
  externalAccountId: z.string(),
  accountType: z.string().nullable(),
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable(),
  lastCheckedAt: z.string(),
  connectedAt: z.string(),
});
export type SocialAccountDto = z.infer<typeof socialAccountSchema>;

export const publicationSchema = z.object({
  platform: socialPlatformSchema,
  status: z.enum(PUBLICATION_STATUSES),
  externalUrl: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** Published with a caveat (e.g. uploaded without cover, link not found). */
  warningMessage: z.string().nullable(),
  publishedAt: z.string().nullable(),
  /** Attempts made so far (first upload included). */
  attempts: z.number().int(),
  /** Failed only: when the next automatic (or requested) attempt runs; null = none. */
  nextAttemptAt: z.string().nullable(),
});
export type PublicationDto = z.infer<typeof publicationSchema>;

export const queueItemSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  topicNumber: z.number().int(),
  partNumber: z.number().int().nullable(),
  title: z.string(),
  videoFileId: z.string(),
  videoFileName: z.string(),
  thumbnailFileId: z.string().nullable(),
  thumbnailFileName: z.string().nullable(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  scheduledAt: z.string().nullable(),
  isPaused: z.boolean(),
  locked: z.boolean(),
  lockReason: z.enum(ITEM_LOCK_REASONS).nullable(),
  publications: z.array(publicationSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QueueItemDto = z.infer<typeof queueItemSchema>;

export const batchSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  ideaNumber: z.number().int(),
  driveFolderUrl: z.string(),
  platforms: z.array(socialPlatformSchema),
  status: z.enum(BATCH_STATUSES),
  itemCount: z.number().int(),
  publishedCount: z.number().int(),
  nextScheduledAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BatchSummaryDto = z.infer<typeof batchSummarySchema>;

export const batchDetailSchema = batchSummarySchema.extend({
  items: z.array(queueItemSchema),
  accounts: z.array(socialAccountSchema),
  settings: socialSettingsSchema,
  /** Server clock, so the UI can show lock countdowns consistently. */
  serverTime: z.string(),
});
export type BatchDetailDto = z.infer<typeof batchDetailSchema>;

export const batchListResponseSchema = z.object({ items: z.array(batchSummarySchema) });
export type BatchListResponse = z.infer<typeof batchListResponseSchema>;

export const batchResponseSchema = z.object({ batch: batchDetailSchema });
export type BatchResponse = z.infer<typeof batchResponseSchema>;

export const scanWarningSchema = z.object({ fileName: z.string(), message: z.string() });
export type ScanWarning = z.infer<typeof scanWarningSchema>;

export const scanResponseSchema = z.object({
  batch: batchDetailSchema,
  report: z.object({
    added: z.number().int(),
    warnings: z.array(scanWarningSchema),
  }),
});
export type ScanResponse = z.infer<typeof scanResponseSchema>;

// ---- Requests ----------------------------------------------------------------------

const batchTitleSchema = z
  .string({ error: 'Ide wajib diisi' })
  .trim()
  .min(1, 'Ide wajib diisi')
  .max(200, 'Ide maksimal 200 karakter');

const platformsSchema = z
  .array(socialPlatformSchema)
  .max(SOCIAL_PLATFORMS.length)
  .transform((platforms) => [...new Set(platforms)]);

export const createBatchRequestSchema = z.object({
  title: batchTitleSchema,
  driveFolderUrl: driveFolderUrlSchema,
  platforms: platformsSchema.default([]),
});
export type CreateBatchRequest = z.infer<typeof createBatchRequestSchema>;

export const updateBatchRequestSchema = z
  .object({
    title: batchTitleSchema.optional(),
    driveFolderUrl: driveFolderUrlSchema.optional(),
    platforms: platformsSchema.optional(),
    ideaNumber: z.number().int().min(0, 'Minimal 0').max(9999, 'Maksimal 9999').optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Tidak ada perubahan yang dikirim',
  });
export type UpdateBatchRequest = z.infer<typeof updateBatchRequestSchema>;

export const createItemRequestSchema = z.object({
  title: itemTitleSchema,
  topicNumber: topicNumberSchema.optional(),
  partNumber: partNumberSchema.optional(),
  videoUrl: driveFileUrlSchema,
  thumbnailUrl: driveFileUrlSchema.nullable().optional(),
  caption: captionSchema.default(''),
  hashtags: hashtagsSchema.default([]),
  scheduledAt: isoDateTimeSchema.nullable().optional(),
});
export type CreateItemRequest = z.infer<typeof createItemRequestSchema>;

export const updateItemRequestSchema = z
  .object({
    title: itemTitleSchema.optional(),
    topicNumber: topicNumberSchema.optional(),
    partNumber: partNumberSchema.optional(),
    videoUrl: driveFileUrlSchema.optional(),
    /** null removes the thumbnail. */
    thumbnailUrl: driveFileUrlSchema.nullable().optional(),
    caption: captionSchema.optional(),
    hashtags: hashtagsSchema.optional(),
    scheduledAt: isoDateTimeSchema.nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Tidak ada perubahan yang dikirim',
  });
export type UpdateItemRequest = z.infer<typeof updateItemRequestSchema>;

export const resumeItemRequestSchema = z.object({
  /** Required when the batch is already scheduled. */
  scheduledAt: isoDateTimeSchema.nullable().optional(),
});
export type ResumeItemRequest = z.infer<typeof resumeItemRequestSchema>;

export const retryPublicationRequestSchema = z.object({ platform: socialPlatformSchema });
export type RetryPublicationRequest = z.infer<typeof retryPublicationRequestSchema>;

export const reorderItemsRequestSchema = z.object({
  itemIds: z.array(z.uuid('ID tidak valid')).min(1).max(1000),
});
export type ReorderItemsRequest = z.infer<typeof reorderItemsRequestSchema>;

export const SCHEDULE_INTERVAL_OPTIONS = [
  { minutes: 360, label: 'Setiap 6 jam' },
  { minutes: 720, label: 'Setiap 12 jam' },
  { minutes: 1440, label: 'Selisih 1 hari' },
  { minutes: 2880, label: 'Selisih 2 hari' },
  { minutes: 4320, label: 'Selisih 3 hari' },
  { minutes: 10080, label: 'Selisih 7 hari' },
] as const;

export const autoScheduleRequestSchema = z.object({
  startAt: isoDateTimeSchema,
  intervalMinutes: z
    .number({ error: 'Selisih wajib dipilih' })
    .int()
    .min(15, 'Selisih minimal 15 menit')
    .max(43200, 'Selisih maksimal 30 hari'),
});
export type AutoScheduleRequest = z.infer<typeof autoScheduleRequestSchema>;

export const connectInstagramRequestSchema = z.object({
  accessToken: z
    .string({ error: 'Access token wajib diisi' })
    .trim()
    .min(20, 'Access token terlalu pendek')
    .max(2048, 'Access token terlalu panjang')
    .regex(/^[A-Za-z0-9._|-]+$/, 'Access token mengandung karakter yang tidak valid'),
});
export type ConnectInstagramRequest = z.infer<typeof connectInstagramRequestSchema>;

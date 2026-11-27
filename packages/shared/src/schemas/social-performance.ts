import { z } from 'zod';

import { socialPlatformSchema } from './social.js';

/**
 * Social Media Performance AIgent — reads each idea's connected accounts straight from
 * the platform (nothing is stored). Instagram only for now; the other platforms show
 * "segera hadir".
 */

// ---- Ideas with their connected accounts -------------------------------------------

export const performanceAccountSchema = z.object({
  platform: socialPlatformSchema,
  username: z.string().nullable(),
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable(),
});
export type PerformanceAccountDto = z.infer<typeof performanceAccountSchema>;

export const performanceIdeaSchema = z.object({
  id: z.string(),
  ideaNumber: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  archivedAt: z.string().nullable(),
  accounts: z.array(performanceAccountSchema),
});
export type PerformanceIdeaDto = z.infer<typeof performanceIdeaSchema>;

export const performanceIdeaListResponseSchema = z.object({
  items: z.array(performanceIdeaSchema),
});
export type PerformanceIdeaListResponse = z.infer<typeof performanceIdeaListResponseSchema>;

export const performanceIdeaResponseSchema = z.object({ idea: performanceIdeaSchema });
export type PerformanceIdeaResponse = z.infer<typeof performanceIdeaResponseSchema>;

// ---- Instagram account overview ----------------------------------------------------

/** Instagram accepts at most 30 days per account-insights request. */
export const PERFORMANCE_RANGE_OPTIONS = [7, 14, 30] as const;
export type PerformanceRangeDays = (typeof PERFORMANCE_RANGE_OPTIONS)[number];

export const instagramOverviewQuerySchema = z.object({
  days: z.coerce
    .number()
    .pipe(z.literal(PERFORMANCE_RANGE_OPTIONS, { error: 'Rentang waktu tidak didukung' }))
    .default(7),
  /** Bypasses the short server cache ("Perbarui"). */
  refresh: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

const metricValue = z.number().nullable();

export const INSTAGRAM_ACCOUNT_TOTAL_KEYS = [
  'views',
  'reach',
  'accountsEngaged',
  'totalInteractions',
  'likes',
  'comments',
  'shares',
  'saves',
  'profileLinksTaps',
  'follows',
  'unfollows',
] as const;
export type InstagramAccountTotalKey = (typeof INSTAGRAM_ACCOUNT_TOTAL_KEYS)[number];

export const dailyPointSchema = z.object({ date: z.string(), value: z.number() });
export type DailyPoint = z.infer<typeof dailyPointSchema>;

export const instagramOverviewSchema = z.object({
  profile: z.object({
    username: z.string(),
    name: z.string().nullable(),
    profilePictureUrl: z.string().nullable(),
    followersCount: metricValue,
    followsCount: metricValue,
    mediaCount: metricValue,
  }),
  range: z.object({ days: z.number().int(), since: z.string(), until: z.string() }),
  /** null = Instagram returned nothing for this metric (e.g. under 100 followers). */
  totals: z.record(z.enum(INSTAGRAM_ACCOUNT_TOTAL_KEYS), metricValue),
  daily: z.object({
    reach: z.array(dailyPointSchema).nullable(),
    newFollowers: z.array(dailyPointSchema).nullable(),
  }),
  fetchedAt: z.string(),
});
export type InstagramOverviewDto = z.infer<typeof instagramOverviewSchema>;

export const instagramOverviewResponseSchema = z.object({ overview: instagramOverviewSchema });
export type InstagramOverviewResponse = z.infer<typeof instagramOverviewResponseSchema>;

// ---- Instagram posts ---------------------------------------------------------------

export const instagramMediaQuerySchema = z.object({
  /** Paging cursor from the previous page. */
  after: z
    .string()
    .regex(/^[A-Za-z0-9_=-]{1,500}$/, { error: 'Cursor tidak valid' })
    .optional(),
  refresh: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const instagramMediaMetricsSchema = z.object({
  views: metricValue,
  reach: metricValue,
  likes: metricValue,
  comments: metricValue,
  shares: metricValue,
  saved: metricValue,
  totalInteractions: metricValue,
  /** Reels only, milliseconds. */
  avgWatchTimeMs: metricValue,
  /** Reels only, milliseconds. */
  totalWatchTimeMs: metricValue,
  /** Reels only, percent of views skipped in the first 3 seconds. */
  skipRate: metricValue,
  reposts: metricValue,
});
export type InstagramMediaMetrics = z.infer<typeof instagramMediaMetricsSchema>;

export const instagramMediaSchema = z.object({
  id: z.string(),
  /** IMAGE, VIDEO, CAROUSEL_ALBUM */
  mediaType: z.string(),
  /** FEED, REELS, … */
  productType: z.string().nullable(),
  caption: z.string(),
  permalink: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  timestamp: z.string().nullable(),
  /** Without insights (see insightsError) only likes and comments are filled. */
  metrics: instagramMediaMetricsSchema,
  /** Why Instagram gave no insights for this post, if it gave none. */
  insightsError: z.string().nullable(),
  /** Set when the post was uploaded by Publisher AIgent. */
  publisherItem: z
    .object({
      topicNumber: z.number().int(),
      partNumber: z.number().int().nullable(),
      title: z.string(),
    })
    .nullable(),
});
export type InstagramMediaDto = z.infer<typeof instagramMediaSchema>;

export const instagramMediaPageSchema = z.object({
  items: z.array(instagramMediaSchema),
  nextCursor: z.string().nullable(),
  fetchedAt: z.string(),
});
export type InstagramMediaPageDto = z.infer<typeof instagramMediaPageSchema>;

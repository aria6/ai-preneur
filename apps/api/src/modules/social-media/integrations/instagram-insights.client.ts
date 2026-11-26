import type {
  DailyPoint,
  InstagramAccountTotalKey,
  InstagramMediaMetrics,
} from '@ai-preneur/shared';
import { z } from 'zod';

import { graphRequest, InstagramApiError } from './instagram.client.js';

/**
 * Read-only Instagram Insights (account and post performance). Works with both token
 * kinds; the token needs the insights permission (`instagram_manage_insights` for
 * Unified login, `instagram_business_manage_insights` for Instagram Login).
 *
 * Instagram returns nothing (or an error) for some metrics on small accounts, so every
 * metric is optional: one unavailable metric never hides the others.
 */

/** Graph error codes for "this token lacks the permission". */
const PERMISSION_CODES = new Set([10, 200]);

export function isMissingPermission(error: unknown): boolean {
  return (
    error instanceof InstagramApiError && error.code !== null && PERMISSION_CODES.has(error.code)
  );
}

/** Errors that stop the whole request: retrying metric by metric would not help. */
function isFatal(error: unknown): boolean {
  return (
    !(error instanceof InstagramApiError) ||
    error.tokenInvalid ||
    error.retryable ||
    isMissingPermission(error)
  );
}

const numeric = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite());

const insightsSchema = z.object({
  data: z
    .array(
      z.object({
        name: z.string(),
        values: z
          .array(z.object({ value: z.unknown(), end_time: z.string().optional() }))
          .optional(),
        total_value: z
          .object({
            value: z.unknown().optional(),
            breakdowns: z
              .array(
                z.object({
                  results: z
                    .array(z.object({ dimension_values: z.array(z.string()), value: z.unknown() }))
                    .default([]),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});
type InsightEntry = z.infer<typeof insightsSchema>['data'][number];

function toNumber(value: unknown): number | null {
  const parsed = numeric.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** total_value (account metrics) or the single lifetime value (media metrics). */
function entryValue(entry: InsightEntry): number | null {
  if (entry.total_value?.value !== undefined) return toNumber(entry.total_value.value);
  return toNumber(entry.values?.[0]?.value);
}

function parseInsights(body: unknown): InsightEntry[] {
  const parsed = insightsSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (insight).');
  return parsed.data.data;
}

/**
 * Asks for several metrics in one call; when Instagram refuses the combination (one
 * metric unsupported for this account or post), asks for each metric on its own so the
 * supported ones still show.
 */
async function fetchMetrics(
  accessToken: string,
  path: string,
  metrics: readonly string[],
  params: Record<string, string>,
  action: string,
): Promise<Map<string, InsightEntry>> {
  const byName = (entries: InsightEntry[]) => new Map(entries.map((entry) => [entry.name, entry]));
  try {
    const body = await graphRequest(
      'GET',
      path,
      accessToken,
      { ...params, metric: metrics.join(',') },
      action,
    );
    return byName(parseInsights(body));
  } catch (error) {
    if (isFatal(error) || metrics.length === 1) throw error;
  }

  const results = await Promise.allSettled(
    metrics.map(async (metric) =>
      parseInsights(await graphRequest('GET', path, accessToken, { ...params, metric }, action)),
    ),
  );
  const fatal = results.find(
    (result): result is PromiseRejectedResult =>
      result.status === 'rejected' && isFatal(result.reason),
  );
  if (fatal) throw fatal.reason;
  const [first] = results;
  if (first?.status === 'rejected' && results.every((result) => result.status === 'rejected')) {
    throw first.reason;
  }
  return byName(results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])));
}

// ---- Account ---------------------------------------------------------------------

const profileSchema = z.object({
  username: z.string(),
  name: z.string().optional(),
  profile_picture_url: z.string().optional(),
  followers_count: z.unknown().optional(),
  follows_count: z.unknown().optional(),
  media_count: z.unknown().optional(),
});

export interface InstagramProfile {
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
}

export async function getProfile(accessToken: string, igUserId: string): Promise<InstagramProfile> {
  const body = await graphRequest(
    'GET',
    `/${igUserId}`,
    accessToken,
    { fields: 'username,name,profile_picture_url,followers_count,follows_count,media_count' },
    'membaca profil akun',
  );
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (profil).');
  return {
    username: parsed.data.username,
    name: parsed.data.name || null,
    profilePictureUrl: parsed.data.profile_picture_url ?? null,
    followersCount: toNumber(parsed.data.followers_count),
    followsCount: toNumber(parsed.data.follows_count),
    mediaCount: toNumber(parsed.data.media_count),
  };
}

/** Account metrics summed over the range (`metric_type=total_value`). */
const ACCOUNT_TOTAL_METRICS = {
  views: 'views',
  reach: 'reach',
  accountsEngaged: 'accounts_engaged',
  totalInteractions: 'total_interactions',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
  saves: 'saves',
  profileLinksTaps: 'profile_links_taps',
} as const satisfies Partial<Record<InstagramAccountTotalKey, string>>;

export interface InsightRange {
  /** Unix seconds. Instagram accepts at most 30 days between since and until. */
  since: number;
  until: number;
}

export async function getAccountTotals(
  accessToken: string,
  igUserId: string,
  range: InsightRange,
): Promise<Record<InstagramAccountTotalKey, number | null>> {
  const params = {
    period: 'day',
    metric_type: 'total_value',
    since: String(range.since),
    until: String(range.until),
  };
  const path = `/${igUserId}/insights`;
  const action = 'membaca insight akun';

  const [totals, follows] = await Promise.all([
    fetchMetrics(accessToken, path, Object.values(ACCOUNT_TOTAL_METRICS), params, action),
    // Needs its own call (breakdown); Instagram leaves it out under 100 followers.
    fetchMetrics(
      accessToken,
      path,
      ['follows_and_unfollows'],
      { ...params, breakdown: 'follow_type' },
      action,
    ).catch((error: unknown) => {
      if (isFatal(error)) throw error;
      return new Map<string, InsightEntry>();
    }),
  ]);

  const result = Object.fromEntries(
    Object.entries(ACCOUNT_TOTAL_METRICS).map(([key, metric]) => {
      const entry = totals.get(metric);
      return [key, entry ? entryValue(entry) : null];
    }),
  ) as Record<keyof typeof ACCOUNT_TOTAL_METRICS, number | null>;

  // follow_type: FOLLOWER = new follows, NON_FOLLOWER = unfollows.
  const followResults =
    follows.get('follows_and_unfollows')?.total_value?.breakdowns?.[0]?.results ?? [];
  const followValue = (dimension: string) => {
    const match = followResults.find((row) => row.dimension_values.includes(dimension));
    return match ? toNumber(match.value) : null;
  };
  return {
    ...result,
    follows: followValue('FOLLOWER'),
    unfollows: followValue('NON_FOLLOWER'),
  };
}

/**
 * Daily values end at midnight Pacific time (`end_time` 07:00/08:00 UTC) and count the
 * day before: shifting back 12 hours gives that day's date.
 */
function toDailyPoints(entry: InsightEntry | undefined): DailyPoint[] {
  return (entry?.values ?? []).flatMap((point) => {
    const value = toNumber(point.value);
    const end = point.end_time ? new Date(point.end_time).getTime() : Number.NaN;
    if (value === null || Number.isNaN(end)) return [];
    return [{ date: new Date(end - 12 * 3_600_000).toISOString().slice(0, 10), value }];
  });
}

/**
 * Daily series for the chart: reach (the only account metric with a daily series) and
 * new followers per day (not available under 100 followers). null = not available.
 */
export async function getAccountDaily(
  accessToken: string,
  igUserId: string,
  range: InsightRange,
): Promise<{ reach: DailyPoint[] | null; newFollowers: DailyPoint[] | null }> {
  const path = `/${igUserId}/insights`;
  const since = String(range.since);
  const until = String(range.until);
  const optional = (promise: Promise<Map<string, InsightEntry>>, metric: string) =>
    promise.then(
      (entries) => (entries.has(metric) ? toDailyPoints(entries.get(metric)) : null),
      (error: unknown) => {
        if (isFatal(error)) throw error;
        return null;
      },
    );

  const [reach, newFollowers] = await Promise.all([
    optional(
      fetchMetrics(
        accessToken,
        path,
        ['reach'],
        { period: 'day', metric_type: 'time_series', since, until },
        'membaca reach harian',
      ),
      'reach',
    ),
    optional(
      fetchMetrics(
        accessToken,
        path,
        ['follower_count'],
        { period: 'day', since, until },
        'membaca pengikut harian',
      ),
      'follower_count',
    ),
  ]);
  return { reach, newFollowers };
}

// ---- Posts -----------------------------------------------------------------------

const mediaPageSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).transform(String),
        caption: z.string().optional(),
        media_type: z.string().optional(),
        media_product_type: z.string().optional(),
        permalink: z.string().optional(),
        thumbnail_url: z.string().optional(),
        media_url: z.string().optional(),
        timestamp: z.string().optional(),
        like_count: z.unknown().optional(),
        comments_count: z.unknown().optional(),
      }),
    )
    .default([]),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
      next: z.string().optional(),
    })
    .optional(),
});

export interface InstagramPost {
  id: string;
  mediaType: string;
  productType: string | null;
  caption: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string | null;
  likeCount: number | null;
  commentsCount: number | null;
}

/** One page of the account's posts, newest first. */
export async function listPosts(
  accessToken: string,
  igUserId: string,
  options: { limit: number; after?: string },
): Promise<{ posts: InstagramPost[]; nextCursor: string | null }> {
  const params: Record<string, string> = {
    fields:
      'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
    limit: String(options.limit),
  };
  if (options.after) params.after = options.after;

  const body = await graphRequest(
    'GET',
    `/${igUserId}/media`,
    accessToken,
    params,
    'membaca daftar postingan',
  );
  const parsed = mediaPageSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (media).');

  const posts = parsed.data.data.map((media): InstagramPost => {
    const mediaType = media.media_type ?? 'UNKNOWN';
    const time = media.timestamp ? new Date(media.timestamp) : null;
    return {
      id: media.id,
      mediaType,
      productType: media.media_product_type ?? null,
      caption: media.caption ?? '',
      permalink: media.permalink ?? null,
      // Videos have a separate cover; images and carousels show their (first) image.
      thumbnailUrl: media.thumbnail_url ?? (mediaType === 'VIDEO' ? null : media.media_url) ?? null,
      timestamp: time && !Number.isNaN(time.getTime()) ? time.toISOString() : null,
      likeCount: toNumber(media.like_count),
      commentsCount: toNumber(media.comments_count),
    };
  });
  const paging = parsed.data.paging;
  return { posts, nextCursor: paging?.next ? (paging.cursors?.after ?? null) : null };
}

const MEDIA_BASE_METRICS = [
  'views',
  'reach',
  'likes',
  'comments',
  'shares',
  'saved',
  'total_interactions',
] as const;
const REELS_WATCH_METRICS = ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'] as const;
/**
 * Newer metrics, asked for separately: if Instagram refuses them for a post, the main
 * metrics still come in one call instead of one call per metric.
 */
const MEDIA_NEWER_METRICS = { REELS: ['reels_skip_rate', 'reposts'], FEED: ['reposts'] } as const;

/** Lifetime metrics of one post. Throws when Instagram has none for it. */
export async function getPostMetrics(
  accessToken: string,
  post: Pick<InstagramPost, 'id' | 'productType'>,
): Promise<InstagramMediaMetrics> {
  const isReel = post.productType === 'REELS';
  const path = `/${post.id}/insights`;
  const action = 'membaca insight postingan';
  const [main, newer] = await Promise.all([
    fetchMetrics(
      accessToken,
      path,
      isReel ? [...MEDIA_BASE_METRICS, ...REELS_WATCH_METRICS] : MEDIA_BASE_METRICS,
      {},
      action,
    ),
    fetchMetrics(
      accessToken,
      path,
      isReel ? MEDIA_NEWER_METRICS.REELS : MEDIA_NEWER_METRICS.FEED,
      {},
      action,
    ).catch((error: unknown) => {
      if (isFatal(error)) throw error;
      return new Map<string, InsightEntry>();
    }),
  ]);
  const entries = new Map([...main, ...newer]);
  const value = (metric: string) => {
    const entry = entries.get(metric);
    return entry ? entryValue(entry) : null;
  };
  return {
    views: value('views'),
    reach: value('reach'),
    likes: value('likes'),
    comments: value('comments'),
    shares: value('shares'),
    saved: value('saved'),
    totalInteractions: value('total_interactions'),
    avgWatchTimeMs: value('ig_reels_avg_watch_time'),
    totalWatchTimeMs: value('ig_reels_video_view_total_time'),
    skipRate: value('reels_skip_rate'),
    reposts: value('reposts'),
  };
}

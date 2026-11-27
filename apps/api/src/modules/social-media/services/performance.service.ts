import type { Database, SmAccountRow, SmBatchRow } from '@ai-preneur/database';
import {
  ERROR_CODES,
  type InstagramMediaDto,
  type InstagramMediaPageDto,
  type IdeaListFilter,
  type InstagramOverviewDto,
  type PerformanceIdeaDto,
  type PerformanceRangeDays,
} from '@ai-preneur/shared';

import { AppError, conflict, notFound } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import {
  getAccountDaily,
  getAccountTotals,
  getPostMetrics,
  getProfile,
  isMissingPermission,
  listPosts,
} from '../integrations/instagram-insights.client.js';
import { InstagramApiError, instagramTokenKind } from '../integrations/instagram.client.js';
import { parseInstagramCredentials } from '../publishers/instagram.publisher.js';
import { createAccountsRepository } from '../repositories/accounts.repository.js';
import { createBatchesRepository } from '../repositories/batches.repository.js';
import { createPublicationsRepository } from '../repositories/publications.repository.js';
import { credentialsContext, type CredentialsCipher } from '../security/credentials-cipher.js';
import { credentialsKeyError } from './batch-context.js';

/** Instagram answers are kept this long, so browsing around does not hit its rate limit. */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const POSTS_PER_PAGE = 20;
/** Parallel insight calls per page of posts. */
const POST_INSIGHTS_CONCURRENCY = 5;

/** Small time-limited cache, private to one service instance. */
function createCache() {
  const entries = new Map<string, { expiresAt: number; value: Promise<unknown> }>();
  return {
    get<T>(key: string, refresh: boolean, load: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const hit = entries.get(key);
      if (!refresh && hit && hit.expiresAt > now) return hit.value as Promise<T>;

      if (entries.size >= CACHE_MAX_ENTRIES) {
        for (const [entryKey, entry] of entries) {
          if (entry.expiresAt <= now) entries.delete(entryKey);
        }
        if (entries.size >= CACHE_MAX_ENTRIES) entries.clear();
      }
      const value = load();
      entries.set(key, { expiresAt: now + CACHE_TTL_MS, value });
      // Failures are not cached: the next request asks Instagram again.
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
    /** Drops every entry of one account (its token may have changed). */
    forget(prefix: string): void {
      for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
    },
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

function toIdeaDto(batch: SmBatchRow, accounts: readonly SmAccountRow[]): PerformanceIdeaDto {
  return {
    id: batch.id,
    ideaNumber: batch.ideaNumber,
    title: batch.title,
    description: batch.description,
    archivedAt: batch.archivedAt?.toISOString() ?? null,
    accounts: accounts.map((account) => ({
      platform: account.platform,
      username: account.username,
      status: account.status,
      lastError: account.lastError,
    })),
  };
}

/** Instagram failure → message the page can show (and what the user should do). */
function instagramError(error: unknown, accessToken: string): unknown {
  if (isMissingPermission(error)) {
    const permission =
      instagramTokenKind(accessToken) === 'unified_login'
        ? 'instagram_manage_insights'
        : 'instagram_business_manage_insights';
    return conflict(
      `Token Instagram ide ini belum punya izin membaca insight. Buat ulang token dengan izin ${permission}, lalu hubungkan ulang akun Instagram di Publisher AIgent.`,
    );
  }
  if (error instanceof InstagramApiError) {
    if (error.tokenInvalid) return conflict(error.message);
    return new AppError({
      statusCode: 503,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: error.message,
    });
  }
  return error;
}

/**
 * Social Media Performance AIgent: reads the performance of each idea's connected
 * accounts straight from the platform. Nothing is stored; answers are cached for a few
 * minutes in memory ("Perbarui" bypasses the cache).
 */
export function createPerformanceService(deps: {
  db: Database;
  cipher: CredentialsCipher;
  logger: Logger;
}) {
  const { db, cipher, logger } = deps;
  const batches = createBatchesRepository(db);
  const accounts = createAccountsRepository(db);
  const publications = createPublicationsRepository(db);
  const cache = createCache();

  /** The idea's Instagram account and its token, or an error telling what is missing. */
  async function instagramAccount(batchId: string) {
    const batch = await batches.findById(batchId);
    if (!batch) throw notFound('Ide tidak ditemukan.');
    const account = await accounts.findForBatch(batchId, 'instagram');
    if (!account) {
      throw conflict(
        'Ide ini belum punya akun Instagram yang terhubung. Hubungkan akun di Publisher AIgent.',
      );
    }
    if (account.status === 'error') {
      throw conflict(
        account.lastError ??
          'Akun Instagram ide ini bermasalah. Hubungkan ulang akun di Publisher AIgent.',
      );
    }

    let accessToken: string;
    try {
      accessToken = parseInstagramCredentials(
        cipher.decrypt(account.encryptedCredentials, credentialsContext(batchId, 'instagram')),
      ).accessToken;
    } catch (error) {
      const keyError = credentialsKeyError(error);
      if (keyError !== error) throw keyError;
      throw conflict(
        'Kredensial Instagram tidak terbaca. Hubungkan ulang akun di Publisher AIgent.',
      );
    }
    // The account (and token) can be reconnected at any time: cache per token version.
    const cacheKey = `${account.id}:${account.encryptedCredentials.slice(-16)}`;
    return { account, accessToken, cacheKey };
  }

  async function withInstagram<T>(accessToken: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const mapped = instagramError(error, accessToken);
      if (mapped === error) throw error;
      logger.warn('Instagram insights request failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      throw mapped;
    }
  }

  return {
    async listIdeas(filter: IdeaListFilter): Promise<PerformanceIdeaDto[]> {
      const rows = await batches.list(filter);
      const all = await accounts.listByBatches(rows.map((row) => row.id));
      return rows.map((row) =>
        toIdeaDto(
          row,
          all.filter((account) => account.batchId === row.id),
        ),
      );
    },

    async getIdea(batchId: string): Promise<PerformanceIdeaDto> {
      const batch = await batches.findById(batchId);
      if (!batch) throw notFound('Ide tidak ditemukan.');
      return toIdeaDto(batch, await accounts.listByBatch(batchId));
    },

    async instagramOverview(
      batchId: string,
      days: PerformanceRangeDays,
      refresh: boolean,
    ): Promise<InstagramOverviewDto> {
      const { account, accessToken, cacheKey } = await instagramAccount(batchId);
      return cache.get(`${cacheKey}:overview:${days}`, refresh, () =>
        withInstagram(accessToken, async () => {
          const until = Math.floor(Date.now() / 1000);
          // A minute short of the full span: Instagram refuses ranges over 30 days.
          const range = { since: until - days * 86_400 + 60, until };
          const igUserId = account.externalAccountId;
          const [profile, totals, daily] = await Promise.all([
            getProfile(accessToken, igUserId),
            getAccountTotals(accessToken, igUserId, range),
            getAccountDaily(accessToken, igUserId, range),
          ]);
          return {
            profile,
            range: {
              days,
              since: new Date(range.since * 1000).toISOString(),
              until: new Date(range.until * 1000).toISOString(),
            },
            totals,
            daily,
            fetchedAt: new Date().toISOString(),
          };
        }),
      );
    },

    async instagramMedia(
      batchId: string,
      after: string | undefined,
      refresh: boolean,
    ): Promise<InstagramMediaPageDto> {
      const { account, accessToken, cacheKey } = await instagramAccount(batchId);
      // "Perbarui" reloads the first page; older pages follow from it.
      if (refresh && !after) cache.forget(`${cacheKey}:media:`);
      return cache.get(`${cacheKey}:media:${after ?? ''}`, refresh, () =>
        withInstagram(accessToken, async () => {
          const page = await listPosts(accessToken, account.externalAccountId, {
            limit: POSTS_PER_PAGE,
            ...(after ? { after } : {}),
          });
          const refs = await publications.findPublishedByMediaIds(
            batchId,
            'instagram',
            page.posts.map((post) => post.id),
          );
          const items = await mapWithConcurrency(
            page.posts,
            POST_INSIGHTS_CONCURRENCY,
            async (post): Promise<InstagramMediaDto> => {
              const ref = refs.find((candidate) => candidate.externalMediaId === post.id);
              const base = {
                id: post.id,
                mediaType: post.mediaType,
                productType: post.productType,
                caption: post.caption,
                permalink: post.permalink,
                thumbnailUrl: post.thumbnailUrl,
                timestamp: post.timestamp,
                publisherItem: ref
                  ? { topicNumber: ref.topicNumber, partNumber: ref.partNumber, title: ref.title }
                  : null,
              };
              try {
                const metrics = await getPostMetrics(accessToken, post);
                return { ...base, metrics, insightsError: null };
              } catch (error) {
                // Token/permission/rate-limit problems concern the whole page.
                if (
                  !(error instanceof InstagramApiError) ||
                  error.tokenInvalid ||
                  error.retryable ||
                  isMissingPermission(error)
                ) {
                  throw error;
                }
                return {
                  ...base,
                  metrics: {
                    views: null,
                    reach: null,
                    likes: post.likeCount,
                    comments: post.commentsCount,
                    shares: null,
                    saved: null,
                    totalInteractions: null,
                    avgWatchTimeMs: null,
                    totalWatchTimeMs: null,
                    skipRate: null,
                    reposts: null,
                  },
                  insightsError: error.message,
                };
              }
            },
          );
          return { items, nextCursor: page.nextCursor, fetchedAt: new Date().toISOString() };
        }),
      );
    },
  };
}

export type PerformanceService = ReturnType<typeof createPerformanceService>;

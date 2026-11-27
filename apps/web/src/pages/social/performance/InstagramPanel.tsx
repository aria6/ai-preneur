import {
  PERFORMANCE_RANGE_OPTIONS,
  type InstagramMediaDto,
  type InstagramOverviewDto,
  type PerformanceAccountDto,
  type PerformanceRangeDays,
} from '@ai-preneur/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Button } from '../../../components/ui/Button';
import { Alert, Card, EmptyState } from '../../../components/ui/feedback';
import { Icon } from '../../../components/ui/Icon';
import { Spinner } from '../../../components/ui/Spinner';
import { formatDateTime } from '../../../lib/format';
import { cn } from '../../../lib/cn';
import { errorMessage } from '../../../lib/errors';
import * as performanceService from '../../../services/social-performance.service';
import { BarChart, type BarDatum } from './BarChart';
import { formatDuration, formatMetric, formatPercent } from './performance-ui';

const dayLabel = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
const dayTitle = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function dailyBars(points: readonly { date: string; value: number }[]): BarDatum[] {
  return points.map((point) => {
    const date = new Date(`${point.date}T12:00:00`);
    return { label: dayLabel.format(date), title: dayTitle.format(date), value: point.value };
  });
}

const TOTAL_TILES: readonly {
  key: keyof InstagramOverviewDto['totals'];
  label: string;
  hint?: string;
}[] = [
  { key: 'views', label: 'Views', hint: 'Berapa kali konten diputar/dilihat' },
  { key: 'reach', label: 'Reach', hint: 'Akun unik yang melihat konten' },
  { key: 'accountsEngaged', label: 'Akun berinteraksi' },
  { key: 'totalInteractions', label: 'Total interaksi' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Komentar' },
  { key: 'shares', label: 'Dibagikan' },
  { key: 'saves', label: 'Disimpan' },
  { key: 'profileLinksTaps', label: 'Klik link profil' },
  { key: 'follows', label: 'Pengikut baru' },
  { key: 'unfollows', label: 'Berhenti mengikuti' },
];

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3" title={hint}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}

function RangePicker({
  value,
  onChange,
  disabled,
}: {
  value: PerformanceRangeDays;
  onChange: (days: PerformanceRangeDays) => void;
  disabled: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group">
      {PERFORMANCE_RANGE_OPTIONS.map((days) => (
        <button
          key={days}
          type="button"
          disabled={disabled}
          aria-pressed={value === days}
          onClick={() => onChange(days)}
          className={cn(
            'h-8 rounded-md px-3 text-sm',
            value === days
              ? 'bg-primary-600 font-medium text-white'
              : 'text-slate-600 hover:bg-slate-100 disabled:opacity-50',
          )}
        >
          {days} hari
        </button>
      ))}
    </div>
  );
}

function ProfileCard({ overview }: { overview: InstagramOverviewDto }) {
  const { profile } = overview;
  return (
    <Card className="flex flex-wrap items-center gap-4 p-5">
      {profile.profilePictureUrl ? (
        <img
          src={profile.profilePictureUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-14 rounded-full border border-slate-200 object-cover"
        />
      ) : (
        <span className="flex size-14 items-center justify-center rounded-full bg-pink-50 font-semibold text-pink-700">
          IG
        </span>
      )}
      <div className="min-w-0 flex-1">
        <a
          href={`https://www.instagram.com/${encodeURIComponent(profile.username)}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-primary-700"
        >
          @{profile.username} <Icon name="external" className="size-3.5" />
        </a>
        {profile.name && <p className="truncate text-sm text-slate-500">{profile.name}</p>}
      </div>
      <dl className="flex gap-6 text-center">
        {[
          { label: 'Pengikut', value: profile.followersCount },
          { label: 'Mengikuti', value: profile.followsCount },
          { label: 'Postingan', value: profile.mediaCount },
        ].map((item) => (
          <div key={item.label} className="flex flex-col-reverse">
            <dt className="text-xs text-slate-500">{item.label}</dt>
            <dd className="text-lg font-semibold text-slate-900 tabular-nums">
              {formatMetric(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function DailyChartCard({
  title,
  points,
  valueLabel,
  unavailable,
}: {
  title: string;
  points: readonly { date: string; value: number }[] | null;
  valueLabel: string;
  unavailable: string;
}) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-900">{title}</h3>
      {points && points.length > 0 ? (
        <BarChart data={dailyBars(points)} valueLabel={valueLabel} />
      ) : (
        <p className="py-10 text-center text-sm text-slate-400">{unavailable}</p>
      )}
    </Card>
  );
}

const postDate = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function postTypeLabel(post: InstagramMediaDto): string {
  if (post.productType === 'REELS') return 'Reels';
  if (post.mediaType === 'CAROUSEL_ALBUM') return 'Carousel';
  if (post.mediaType === 'VIDEO') return 'Video';
  return 'Foto';
}

function PostsCard({
  posts,
  hasMore,
  loadingMore,
  error,
  onLoadMore,
}: {
  posts: readonly InstagramMediaDto[] | null;
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
  onLoadMore: () => void;
}) {
  if (posts === null) {
    return (
      <Card className="p-5">
        {error ? (
          <Alert>{error}</Alert>
        ) : (
          <div className="flex justify-center py-10 text-slate-400">
            <Spinner className="size-6" />
          </div>
        )}
      </Card>
    );
  }

  // Oldest → newest, so the chart reads left to right in time.
  const chartPosts = [...posts]
    .reverse()
    .filter((post) => post.metrics.views !== null)
    .map((post): BarDatum => ({
      label: post.timestamp ? dayLabel.format(new Date(post.timestamp)) : '—',
      title: `${post.timestamp ? postDate.format(new Date(post.timestamp)) : ''} · ${
        post.publisherItem?.title ?? (post.caption.slice(0, 40) || postTypeLabel(post))
      }`,
      value: post.metrics.views ?? 0,
    }));

  return (
    <Card>
      <div className="border-b border-slate-100 p-5">
        <h3 className="text-sm font-semibold text-slate-900">Views per postingan</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Total sejak diunggah, untuk {posts.length} postingan terbaru yang dimuat.
        </p>
        <div className="mt-4">
          {chartPosts.length > 0 ? (
            <BarChart data={chartPosts} valueLabel="views" />
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">Belum ada data views.</p>
          )}
        </div>
      </div>

      {posts.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-400">Akun ini belum punya postingan.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Postingan</th>
                {[
                  'Views',
                  'Reach',
                  'Likes',
                  'Komentar',
                  'Dibagikan',
                  'Disimpan',
                  'Rata-rata ditonton',
                  'Skip 3 dtk',
                ].map((heading) => (
                  <th key={heading} className="px-3 py-2 text-right font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {posts.map((post) => (
                <tr key={post.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      {post.thumbnailUrl ? (
                        <img
                          src={post.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-16 w-12 shrink-0 rounded-md bg-slate-100 object-cover"
                        />
                      ) : (
                        <span className="h-16 w-12 shrink-0 rounded-md bg-slate-100" />
                      )}
                      <div className="min-w-0 max-w-xs">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <span className="font-medium text-slate-700">{postTypeLabel(post)}</span>
                          <span>
                            · {post.timestamp ? postDate.format(new Date(post.timestamp)) : '—'}
                          </span>
                          {post.publisherItem && (
                            <span
                              className="rounded bg-primary-50 px-1.5 py-0.5 font-medium text-primary-700"
                              title="Diunggah lewat Publisher AIgent"
                            >
                              Topik {post.publisherItem.topicNumber}
                              {post.publisherItem.partNumber !== null &&
                                ` · part ${post.publisherItem.partNumber}`}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-slate-800">
                          {post.publisherItem?.title ?? (post.caption || 'Tanpa caption')}
                        </p>
                        {post.permalink && (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-xs text-primary-700 hover:underline"
                          >
                            Buka di Instagram <Icon name="external" className="size-3" />
                          </a>
                        )}
                        {post.insightsError && (
                          <p className="mt-1 text-xs text-amber-700" title={post.insightsError}>
                            Insight tidak tersedia untuk postingan ini.
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  {[
                    formatMetric(post.metrics.views),
                    formatMetric(post.metrics.reach),
                    formatMetric(post.metrics.likes),
                    formatMetric(post.metrics.comments),
                    formatMetric(post.metrics.shares),
                    formatMetric(post.metrics.saved),
                    formatDuration(post.metrics.avgWatchTimeMs),
                    formatPercent(post.metrics.skipRate),
                  ].map((value, index) => (
                    <td key={index} className="px-3 py-3 text-right text-slate-800 tabular-nums">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(hasMore || error) && (
        <div className="space-y-3 border-t border-slate-100 p-4 text-center">
          {error && <Alert>{error}</Alert>}
          {hasMore && (
            <Button variant="secondary" size="sm" onClick={onLoadMore} loading={loadingMore}>
              Muat lebih banyak
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/** Instagram tab of an idea: account summary, daily charts and every post's metrics. */
export function InstagramPanel({
  ideaId,
  account,
}: {
  ideaId: string;
  account: PerformanceAccountDto | undefined;
}) {
  const [days, setDays] = useState<PerformanceRangeDays>(7);
  const [overview, setOverview] = useState<InstagramOverviewDto | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [posts, setPosts] = useState<InstagramMediaDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const usable = account?.status === 'connected';

  const loadOverview = useCallback(
    (range: PerformanceRangeDays, refresh: boolean, signal?: AbortSignal) =>
      performanceService
        .getInstagramOverview(ideaId, { days: range, refresh, ...(signal ? { signal } : {}) })
        .then((next) => {
          setOverview(next);
          setOverviewError(null);
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) setOverviewError(errorMessage(error));
        }),
    [ideaId],
  );

  const loadPosts = useCallback(
    (refresh: boolean, signal?: AbortSignal) =>
      performanceService
        .getInstagramMedia(ideaId, { refresh, ...(signal ? { signal } : {}) })
        .then((page) => {
          setPosts(page.items);
          setNextCursor(page.nextCursor);
          setPostsError(null);
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) setPostsError(errorMessage(error));
        }),
    [ideaId],
  );

  useEffect(() => {
    if (!usable) return;
    const controller = new AbortController();
    void loadOverview(days, false, controller.signal);
    return () => controller.abort();
  }, [usable, days, loadOverview]);

  useEffect(() => {
    if (!usable) return;
    const controller = new AbortController();
    void loadPosts(false, controller.signal);
    return () => controller.abort();
  }, [usable, loadPosts]);

  if (!account) {
    return (
      <EmptyState
        icon="chart"
        title="Belum ada akun Instagram"
        description="Hubungkan akun Instagram untuk ide ini di Publisher AIgent, lalu kembali ke sini."
        action={
          <Link
            to={`/social/publisher/${ideaId}`}
            className="text-sm font-medium text-primary-700 hover:underline"
          >
            Buka di Publisher AIgent
          </Link>
        }
      />
    );
  }

  if (!usable) {
    return (
      <Alert>
        {account.lastError ?? 'Akun Instagram ide ini bermasalah.'}{' '}
        <Link to={`/social/publisher/${ideaId}`} className="font-medium underline">
          Hubungkan ulang di Publisher AIgent
        </Link>
      </Alert>
    );
  }

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadOverview(days, true), loadPosts(true)]);
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await performanceService.getInstagramMedia(ideaId, { after: nextCursor });
      setPosts((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
      setPostsError(null);
    } catch (error) {
      setPostsError(errorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker value={days} onChange={setDays} disabled={refreshing} />
        <div className="flex items-center gap-3">
          {overview && (
            <span className="text-xs text-slate-500">
              Data diambil {formatDateTime(overview.fetchedAt)}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={() => void refresh()} loading={refreshing}>
            {!refreshing && <Icon name="refresh" className="size-4" />} Perbarui
          </Button>
        </div>
      </div>

      {overviewError && <Alert>{overviewError}</Alert>}

      {overview ? (
        <>
          <ProfileCard overview={overview} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {TOTAL_TILES.map((tile) => (
              <StatTile
                key={tile.key}
                label={tile.label}
                value={formatMetric(overview.totals[tile.key])}
                {...(tile.hint ? { hint: tile.hint } : {})}
              />
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Total {overview.range.days} hari terakhir. Tanda “—” berarti Instagram tidak memberi
            data itu (beberapa metrik hanya tersedia untuk akun dengan minimal 100 pengikut).
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <DailyChartCard
              title="Reach harian"
              points={overview.daily.reach}
              valueLabel="akun"
              unavailable="Instagram belum memberi data reach harian."
            />
            <DailyChartCard
              title="Pengikut baru harian"
              points={overview.daily.newFollowers}
              valueLabel="pengikut baru"
              unavailable="Tidak tersedia — Instagram hanya memberi data ini untuk akun dengan minimal 100 pengikut."
            />
          </div>
        </>
      ) : (
        !overviewError && (
          <div className="flex justify-center py-16 text-slate-400">
            <Spinner className="size-7" />
          </div>
        )
      )}

      <PostsCard
        posts={posts}
        hasMore={nextCursor !== null}
        loadingMore={loadingMore}
        error={postsError}
        onLoadMore={() => void loadMore()}
      />
    </div>
  );
}

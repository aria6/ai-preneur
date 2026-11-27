import type {
  CollectedCommentPageDto,
  CollectedPostDto,
  CommentAuthorFilter,
} from '@ai-preneur/shared';
import { useEffect, useState } from 'react';

import { Alert, Badge, Card, EmptyState } from '../../../components/ui/feedback';
import { SelectField, TextField } from '../../../components/ui/fields';
import { Icon } from '../../../components/ui/Icon';
import { Spinner } from '../../../components/ui/Spinner';
import { useDebouncedValue } from '../../../hooks/use-debounced-value';
import { errorMessage } from '../../../lib/errors';
import { formatDateTime } from '../../../lib/format';
import * as analysisService from '../../../services/social-analysis.service';
import { formatMetric } from '../performance/performance-ui';
import { postLabel } from './analysis-ui';
import { Pagination } from './Pagination';

const AUTHOR_LABELS: Record<CommentAuthorFilter, string> = {
  all: 'Semua penulis',
  audience: 'Audiens saja',
  account: 'Akun sendiri saja',
};

function PostThumb({ url }: { url: string | null }) {
  return url ? (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="size-12 shrink-0 rounded-md bg-slate-100 object-cover"
    />
  ) : (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400">
      <Icon name="play" className="size-4" />
    </span>
  );
}

export function CommentsTab({ ideaId, version }: { ideaId: string; version: number }) {
  const [posts, setPosts] = useState<CollectedPostDto[]>([]);
  const [postId, setPostId] = useState('');
  const [author, setAuthor] = useState<CommentAuthorFilter>('all');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  // The page belongs to one filter: another filter starts from the first page.
  const filterKey = `${postId}|${author}|${q}`;
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const setPage = (next: number) => setPaging({ key: filterKey, page: next });
  const [loaded, setLoaded] = useState<{
    request: string;
    data: CollectedCommentPageDto | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    analysisService
      .listCollectedPosts(ideaId, controller.signal)
      .then(setPosts)
      .catch(() => undefined);
    return () => controller.abort();
  }, [ideaId, version]);

  const request = `${filterKey}|${page}|${version}`;
  const data = loaded?.data ?? null;
  const error = loaded?.request === request ? loaded.error : null;
  const loading = loaded?.request !== request;

  useEffect(() => {
    const controller = new AbortController();
    analysisService
      .listCollectedComments(ideaId, {
        page,
        author,
        ...(q ? { q } : {}),
        ...(postId ? { postId } : {}),
        signal: controller.signal,
      })
      .then((result) => setLoaded({ request, data: result, error: null }))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setLoaded((previous) => ({
            request,
            data: previous?.data ?? null,
            error: errorMessage(reason),
          }));
        }
      });
    return () => controller.abort();
  }, [ideaId, page, author, q, postId, request]);

  const filtered = Boolean(q || postId || author !== 'all');

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_minmax(0,18rem)_12rem]">
        <TextField
          label="Cari"
          placeholder="Isi komentar atau username"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectField
          label="Postingan"
          value={postId}
          onChange={(event) => setPostId(event.target.value)}
        >
          <option value="">Semua postingan ({posts.length})</option>
          {posts.map((post) => (
            <option key={post.id} value={post.id}>
              {postLabel(post)} — {formatMetric(post.storedComments)} komentar
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Penulis"
          value={author}
          onChange={(event) => setAuthor(event.target.value as CommentAuthorFilter)}
        >
          {(Object.keys(AUTHOR_LABELS) as CommentAuthorFilter[]).map((key) => (
            <option key={key} value={key}>
              {AUTHOR_LABELS[key]}
            </option>
          ))}
        </SelectField>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && loading ? (
        <div className="flex justify-center py-12 text-slate-400">
          <Spinner className="size-6" />
        </div>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon="search"
          title={filtered ? 'Tidak ada komentar yang cocok' : 'Belum ada komentar'}
          description={
            filtered
              ? 'Ubah pencarian atau filter.'
              : 'Komentar baru akan muncul setelah data diperbarui.'
          }
        />
      ) : (
        data && (
          <Card className={loading ? 'opacity-60 transition-opacity' : undefined}>
            <ul className="divide-y divide-slate-100">
              {data.items.map((comment) => (
                <li key={comment.id} className="flex flex-col gap-3 p-4 md:flex-row md:gap-6">
                  <div
                    className={
                      comment.parentExternalId ? 'min-w-0 flex-1 md:pl-6' : 'min-w-0 flex-1'
                    }
                  >
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      {comment.parentExternalId && (
                        <span className="text-xs text-slate-400" title="Balasan komentar">
                          ↳ balasan
                        </span>
                      )}
                      <span className="font-medium text-slate-900">
                        @{comment.username ?? 'tidak diketahui'}
                      </span>
                      {comment.isFromAccount && <Badge color="violet">Akun ini</Badge>}
                      <span className="text-xs text-slate-500">
                        {formatDateTime(comment.commentedAt)}
                      </span>
                      {comment.likeCount !== null && comment.likeCount > 0 && (
                        <span className="text-xs text-slate-500">
                          ♥ {formatMetric(comment.likeCount)}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-sm break-words whitespace-pre-line text-slate-700">
                      {comment.text || <span className="text-slate-400 italic">(tanpa teks)</span>}
                    </p>
                  </div>
                  <div className="flex min-w-0 items-start gap-3 md:w-72 md:shrink-0">
                    <PostThumb url={comment.post.thumbnailUrl} />
                    <div className="min-w-0 text-xs">
                      <p className="line-clamp-2 text-slate-600">{postLabel(comment.post)}</p>
                      <p className="mt-0.5 text-slate-400">
                        {formatDateTime(comment.post.postedAt)}
                      </p>
                      {comment.post.permalink && (
                        <a
                          href={comment.post.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-primary-700 hover:underline"
                        >
                          Buka postingan <Icon name="external" className="size-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={setPage}
            />
          </Card>
        )
      )}
    </div>
  );
}

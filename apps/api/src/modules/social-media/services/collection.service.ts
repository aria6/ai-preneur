import type {
  Database,
  SmCollectedPostRow,
  SmCollectionRunRow,
  SmCollectionSourceRow,
  SmDmMessageRow,
} from '@ai-preneur/database';
import {
  COLLECTION_INITIAL_DAYS,
  DM_READABLE_MESSAGES,
  type AnalysisIdeaDto,
  type CollectedCommentPageDto,
  type CollectedPostDto,
  type CollectionRunDto,
  type CollectionStage,
  type CollectionStatusDto,
  type CollectionSummaryDto,
  type CommentListQuery,
  type ConversationListQuery,
  type DmConversationDetailResponse,
  type DmConversationDto,
  type DmConversationPageDto,
  type DmMessageDto,
  type IdeaListFilter,
} from '@ai-preneur/shared';

import { conflict, notFound } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import type { AuthContext } from '../../iam/index.js';
import {
  getConversationMessages,
  listComments,
  listConversations,
  type InstagramParticipant,
} from '../integrations/instagram-engagement.client.js';
import { isMissingPermission, listPosts } from '../integrations/instagram-insights.client.js';
import { InstagramApiError, instagramTokenKind } from '../integrations/instagram.client.js';
import { createAccountsRepository } from '../repositories/accounts.repository.js';
import { createBatchesRepository } from '../repositories/batches.repository.js';
import {
  createCollectionRepository,
  type NewComment,
  type RunPatch,
  type SourceCounts,
} from '../repositories/collection.repository.js';
import { createPublicationsRepository } from '../repositories/publications.repository.js';
import type { CredentialsCipher } from '../security/credentials-cipher.js';
import { createInstagramAccess, type InstagramAccess } from './instagram-access.js';
import { toIdeaDto } from './performance.service.js';

const DAY_MS = 86_400_000;
const POSTS_PER_PAGE = 50;
/** Posts whose comments are read in parallel. */
const COMMENT_CONCURRENCY = 3;
const COMMENTS_PAGE_SIZE = 50;
const CONVERSATIONS_PAGE_SIZE = 30;
const RUN_HISTORY_LIMIT = 20;
const HEARTBEAT_MS = 30_000;
/** A running collection without heartbeat this long was cut off (server stopped). */
const STALE_RUN_MS = 10 * 60_000;
const STALE_RUN_MESSAGE =
  'Pengambilan terhenti di tengah jalan (server berhenti). Data yang sudah masuk tetap tersimpan; tekan tombolnya lagi untuk melanjutkan.';

const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;

type Permission = 'comments' | 'messages';

function permissionName(accessToken: string, kind: Permission): string {
  const unified = instagramTokenKind(accessToken) === 'unified_login';
  if (kind === 'comments') {
    return unified ? 'instagram_manage_comments' : 'instagram_business_manage_comments';
  }
  return unified ? 'instagram_manage_messages' : 'instagram_business_manage_messages';
}

/** Failure → the message stored on the run (and shown on the page). */
function failureMessage(error: unknown, accessToken: string): string {
  if (isMissingPermission(error)) {
    return `Token Instagram ide ini belum punya izin membaca komentar. Buat ulang token dengan izin ${permissionName(accessToken, 'comments')}, lalu hubungkan ulang akun Instagram di Publisher AIgent.`;
  }
  if (error instanceof InstagramApiError) {
    return error.retryable
      ? `${error.message.replace(' Akan dicoba lagi nanti.', '')} Data yang sudah masuk tetap tersimpan; coba lagi beberapa saat lagi.`
      : error.message;
  }
  return 'Terjadi kesalahan tak terduga saat mengambil data. Data yang sudah masuk tetap tersimpan.';
}

/** Errors that stop the whole run (DM problems only stop the DM step otherwise). */
function stopsEverything(error: unknown): boolean {
  return !(error instanceof InstagramApiError) || error.tokenInvalid || error.retryable;
}

function toRunDto(run: SmCollectionRunRow): CollectionRunDto {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    progressStage: (run.progressStage as CollectionStage | null) ?? null,
    progressDetail: run.progressDetail,
    newPosts: run.newPosts,
    newComments: run.newComments,
    newConversations: run.newConversations,
    newMessages: run.newMessages,
    warnings: run.warnings,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt.toISOString(),
    finishedAt: iso(run.finishedAt),
  };
}

function toSummary(
  source: SmCollectionSourceRow,
  counts: SourceCounts | undefined,
): CollectionSummaryDto {
  return {
    username: source.username,
    windowStart: iso(source.windowStart),
    initialCompletedAt: iso(source.initialCompletedAt),
    lastSucceededAt: iso(source.lastSucceededAt),
    dmCollected: source.dmWatermark !== null,
    postCount: counts?.postCount ?? 0,
    commentCount: counts?.commentCount ?? 0,
    conversationCount: counts?.conversationCount ?? 0,
    messageCount: counts?.messageCount ?? 0,
    incompleteConversationCount: counts?.incompleteConversationCount ?? 0,
  };
}

function toMessageDto(message: SmDmMessageRow): DmMessageDto {
  return {
    id: message.id,
    isFromAccount: message.isFromAccount,
    senderUsername: message.senderUsername,
    text: message.text,
    attachmentTypes: message.attachmentTypes,
    sentAt: message.sentAt.toISOString(),
  };
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const item = items[next++] as T;
      try {
        await run(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  await Promise.all(workers);
}

/**
 * Social Media Analysis Engine — Data Collection AIgent.
 *
 * Collects the comments and DMs of each idea's Instagram account into the database.
 * The first fetch reads COLLECTION_INITIAL_DAYS days back; every later one only reads
 * what changed:
 * - posts: the account's posts inside the window (new ones are added);
 * - comments: only posts whose comments_count changed are opened, and their pages are
 *   read until everything on a page is known and the stored count reaches the reported
 *   one (Instagram can't filter comments by time);
 * - DMs: only conversations active after the last fully read one (`dmWatermark`).
 *
 * A collection runs in the background inside the API process; the page polls its
 * status. Everything is upserted, so a failed or cut-off run is simply continued by
 * the next press.
 */
export function createCollectionService(deps: {
  db: Database;
  cipher: CredentialsCipher;
  logger: Logger;
}) {
  const { db, logger } = deps;
  const repo = createCollectionRepository(db);
  const batches = createBatchesRepository(db);
  const accounts = createAccountsRepository(db);
  const publications = createPublicationsRepository(db);
  const access = createInstagramAccess(deps);

  const failStaleRuns = () =>
    repo.failStaleRuns(new Date(Date.now() - STALE_RUN_MS), STALE_RUN_MESSAGE);

  /** The source whose data the page shows: the connected account, else the latest one. */
  async function viewSource(batchId: string): Promise<SmCollectionSourceRow | undefined> {
    const account = await accounts.findForBatch(batchId, 'instagram');
    if (account) return repo.findSource(batchId, 'instagram', account.externalAccountId);
    return repo.findLatestSource(batchId, 'instagram');
  }

  async function requireSource(batchId: string): Promise<SmCollectionSourceRow> {
    if (!(await batches.findById(batchId))) throw notFound('Ide tidak ditemukan.');
    const source = await viewSource(batchId);
    if (!source) throw notFound('Belum ada data yang dikumpulkan untuk ide ini.');
    return source;
  }

  async function publisherRefs(batchId: string, posts: readonly SmCollectedPostRow[]) {
    const refs = await publications.findPublishedByMediaIds(
      batchId,
      'instagram',
      posts.map((post) => post.externalMediaId),
    );
    return (post: SmCollectedPostRow) => {
      const ref = refs.find((candidate) => candidate.externalMediaId === post.externalMediaId);
      return ref
        ? { topicNumber: ref.topicNumber, partNumber: ref.partNumber, title: ref.title }
        : null;
    };
  }

  // ---- The collection itself -------------------------------------------------------

  async function execute(
    run: SmCollectionRunRow,
    source: SmCollectionSourceRow,
    instagram: InstagramAccess,
  ): Promise<void> {
    const { accessToken, account } = instagram;
    const igUserId = account.externalAccountId;
    const ownUsername = account.username?.toLowerCase() ?? null;
    const isOwn = (participant: { id: string | null; username: string | null }) =>
      participant.id === igUserId ||
      (ownUsername !== null && participant.username?.toLowerCase() === ownUsername);

    const totals = { newPosts: 0, newComments: 0, newConversations: 0, newMessages: 0 };
    const warnings: string[] = [];
    const progress = (stage: CollectionStage, detail: string, extra: RunPatch = {}) =>
      repo.updateRun(run.id, { progressStage: stage, progressDetail: detail, ...totals, ...extra });
    const heartbeat = setInterval(() => {
      repo.updateRun(run.id, {}).catch(() => undefined);
    }, HEARTBEAT_MS);
    heartbeat.unref();

    try {
      const windowStart =
        source.windowStart ?? new Date(Date.now() - COLLECTION_INITIAL_DAYS * DAY_MS);
      if (!source.windowStart) await repo.updateSource(source.id, { windowStart });

      // 1. Posts inside the window (newest first), refreshing their comment counts.
      await progress('posts', 'Membaca daftar postingan');
      let after: string | undefined;
      let postsSeen = 0;
      for (;;) {
        const page = await listPosts(accessToken, igUserId, {
          limit: POSTS_PER_PAGE,
          ...(after ? { after } : {}),
        });
        const inWindow = page.posts.filter(
          (post) => !post.timestamp || new Date(post.timestamp) >= windowStart,
        );
        const insertedCount = await repo.upsertPosts(
          source.id,
          inWindow.map((post) => ({
            externalMediaId: post.id,
            caption: post.caption,
            permalink: post.permalink,
            thumbnailUrl: post.thumbnailUrl,
            mediaType: post.mediaType,
            productType: post.productType,
            postedAt: post.timestamp ? new Date(post.timestamp) : null,
            commentsCount: post.commentsCount ?? 0,
          })),
        );
        totals.newPosts += insertedCount;
        postsSeen += inWindow.length;
        await progress('posts', `${postsSeen} postingan dibaca`);
        // Newest first: a post older than the window means the rest are older too.
        if (!page.nextCursor || inWindow.length < page.posts.length) break;
        after = page.nextCursor;
      }

      // 2. Comments of the posts whose count changed.
      const toSync = await repo.listPostsToSync(source.id);
      let done = 0;
      await progress('comments', `0 dari ${toSync.length} postingan`);
      await mapWithConcurrency(toSync, COMMENT_CONCURRENCY, async (post) => {
        // Read first, then add: `+= await` would lose parallel updates.
        const added = await syncComments(post);
        totals.newComments += added;
        done += 1;
        await progress('comments', `${done} dari ${toSync.length} postingan`);
      });
      if (!source.initialCompletedAt) {
        await repo.updateSource(source.id, { initialCompletedAt: new Date() });
      }

      // 3. DMs. A DM-only problem (permission, unsupported setup) leaves the comments
      // collected and becomes a warning.
      try {
        await syncDms(windowStart);
      } catch (error) {
        if (stopsEverything(error)) throw error;
        warnings.push(dmWarning(error));
      }

      await repo.updateSource(source.id, { lastSucceededAt: new Date() });
      await repo.updateRun(run.id, {
        ...totals,
        warnings,
        status: 'succeeded',
        progressStage: null,
        progressDetail: null,
        finishedAt: new Date(),
      });
    } catch (error) {
      logger.warn('Data collection failed', {
        runId: run.id,
        message: error instanceof Error ? error.message : String(error),
      });
      await repo
        .updateRun(run.id, {
          ...totals,
          warnings,
          status: 'failed',
          errorMessage: failureMessage(error, accessToken).slice(0, 1000),
          finishedAt: new Date(),
        })
        .catch((updateError: unknown) =>
          logger.error('Could not record failed collection', {
            runId: run.id,
            message: updateError instanceof Error ? updateError.message : String(updateError),
          }),
        );
    } finally {
      clearInterval(heartbeat);
    }

    /** Reads a post's new comments; returns how many were new. */
    async function syncComments(post: SmCollectedPostRow): Promise<number> {
      const target = post.commentsCount;
      if (target === 0) {
        await repo.markPostSynced(post.id, 0);
        return 0;
      }
      let stored = await repo.countComments(post.id);
      let added = 0;
      let cursor: string | null = null;
      for (;;) {
        const page = await listComments(accessToken, post.externalMediaId, cursor);
        const known = await repo.knownCommentIds(
          source.id,
          page.comments.map((comment) => comment.id),
        );
        const rows: NewComment[] = page.comments.map((comment) => ({
          sourceId: source.id,
          postId: post.id,
          externalCommentId: comment.id,
          parentExternalId: comment.parentId,
          authorExternalId: comment.authorId,
          username: comment.username,
          isFromAccount: isOwn({ id: comment.authorId, username: comment.username }),
          text: comment.text,
          likeCount: comment.likeCount,
          commentedAt: comment.commentedAt,
        }));
        const insertedCount = await repo.upsertComments(rows);
        added += insertedCount;
        stored += insertedCount;
        const allKnown = page.comments.every((comment) => known.has(comment.id));
        if (!page.nextCursor) break;
        // Everything on this page was known and nothing is missing: the rest is known too.
        if (allKnown && stored >= target) break;
        cursor = page.nextCursor;
      }
      await repo.markPostSynced(post.id, target);
      return added;
    }

    async function syncDms(windowStart: Date): Promise<void> {
      const cutoff = source.dmWatermark ?? windowStart;
      let newest = source.dmWatermark;
      let cursor: string | null = null;
      let read = 0;
      let incomplete = 0;
      await progress('dms', 'Membaca daftar percakapan');
      for (;;) {
        const page = await listConversations(accessToken, igUserId, cursor);
        let anyChanged = false;
        for (const conversation of page.conversations) {
          // Unchanged since the last fully read conversation.
          if (conversation.updatedAt && conversation.updatedAt <= cutoff) continue;
          anyChanged = true;
          const participant: InstagramParticipant | undefined = conversation.participants.find(
            (candidate) => !isOwn(candidate),
          );
          const { inserted, ...row } = await repo.upsertConversation({
            sourceId: source.id,
            externalConversationId: conversation.id,
            participantExternalId: participant?.id ?? null,
            participantUsername: participant?.username ?? null,
            lastMessageAt: conversation.updatedAt,
          });
          if (inserted) totals.newConversations += 1;

          const { messages, hasOlder } = await getConversationMessages(
            accessToken,
            conversation.id,
          );
          const known = await repo.knownMessageIds(
            source.id,
            messages.map((message) => message.id),
          );
          const insertedMessages = await repo.insertMessages(
            messages.map((message) => ({
              sourceId: source.id,
              conversationId: row.id,
              externalMessageId: message.id,
              senderExternalId: message.sender.id,
              senderUsername: message.sender.username,
              isFromAccount: isOwn(message.sender),
              text: message.text,
              attachmentTypes: message.attachmentTypes,
              sentAt: message.sentAt,
            })),
          );
          totals.newMessages += insertedMessages;
          // Older messages exist and none of the readable ones was known: there is a gap.
          if (hasOlder && (inserted || known.size === 0) && !row.possiblyIncomplete) {
            await repo.markConversationIncomplete(row.id);
            incomplete += 1;
          }
          if (conversation.updatedAt && (!newest || conversation.updatedAt > newest)) {
            newest = conversation.updatedAt;
          }
          read += 1;
          await progress('dms', `${read} percakapan dibaca`);
        }
        // Most recently active first: a page without changes means the rest is older.
        if (!page.nextCursor || !anyChanged) break;
        cursor = page.nextCursor;
      }
      if (incomplete > 0) {
        warnings.push(
          `${incomplete} percakapan punya pesan lama yang tidak bisa diambil: Instagram hanya memberi ${DM_READABLE_MESSAGES} pesan terbaru per percakapan. Perbarui data lebih sering agar tidak ada pesan yang terlewat.`,
        );
      }
      await repo.updateSource(source.id, { dmWatermark: newest ?? cutoff });
    }

    function dmWarning(error: unknown): string {
      const lead = source.dmWatermark ? 'DM tidak diperbarui' : 'DM belum diambil';
      if (isMissingPermission(error)) {
        return `${lead}: token belum punya izin ${permissionName(accessToken, 'messages')}. Buat ulang token dengan izin itu, lalu hubungkan ulang akun Instagram di Publisher AIgent.`;
      }
      const detail = error instanceof Error ? error.message : String(error);
      const hint =
        instagramTokenKind(accessToken) === 'unified_login'
          ? ' Untuk token Unified login, Instagram mungkin mensyaratkan akun Instagram terhubung ke Facebook Page agar DM bisa dibaca.'
          : '';
      return `${lead}: ${detail}.${hint}`;
    }
  }

  // ---- Public API --------------------------------------------------------------------

  async function status(batchId: string): Promise<CollectionStatusDto> {
    await failStaleRuns();
    const resolved = await access.resolve(batchId);
    const source = await viewSource(batchId);
    const counts = source ? await repo.countsBySource([source.id]) : undefined;
    const [currentRun, lastRun] = source
      ? await Promise.all([repo.findRunning(source.id), repo.findLastFinished(source.id)])
      : [undefined, undefined];
    return {
      summary: source ? toSummary(source, counts?.get(source.id)) : null,
      currentRun: currentRun ? toRunDto(currentRun) : null,
      lastRun: lastRun ? toRunDto(lastRun) : null,
      blockedReason: resolved.problem?.message ?? null,
      nextKind: source?.initialCompletedAt ? 'update' : 'initial',
    };
  }

  return {
    async listIdeas(filter: IdeaListFilter): Promise<AnalysisIdeaDto[]> {
      await failStaleRuns();
      const rows = await batches.list(filter);
      const ids = rows.map((row) => row.id);
      const [allAccounts, sources] = await Promise.all([
        accounts.listByBatches(ids),
        repo.listSources(ids, 'instagram'),
      ]);
      // The connected account's data, else the idea's most recent one.
      const shown = rows.flatMap((row) => {
        const account = allAccounts.find(
          (candidate) => candidate.batchId === row.id && candidate.platform === 'instagram',
        );
        const own = sources
          .filter((source) => source.batchId === row.id)
          .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        const source = account
          ? own.find((candidate) => candidate.externalAccountId === account.externalAccountId)
          : own[0];
        return source ? [source] : [];
      });
      const sourceIds = shown.map((source) => source.id);
      const [counts, running] = await Promise.all([
        repo.countsBySource(sourceIds),
        repo.runningSourceIds(sourceIds),
      ]);
      return rows.map((row) => {
        const source = shown.find((candidate) => candidate.batchId === row.id);
        return {
          ...toIdeaDto(
            row,
            allAccounts.filter((account) => account.batchId === row.id),
          ),
          instagram: source ? toSummary(source, counts.get(source.id)) : null,
          instagramRunning: source ? running.has(source.id) : false,
        };
      });
    },

    async getIdea(batchId: string): Promise<AnalysisIdeaDto> {
      const batch = await batches.findById(batchId);
      if (!batch) throw notFound('Ide tidak ditemukan.');
      const current = await status(batchId);
      return {
        ...toIdeaDto(batch, await accounts.listByBatch(batchId)),
        instagram: current.summary,
        instagramRunning: current.currentRun !== null,
      };
    },

    status,

    /** "Ambil data" / "Perbarui data": starts a background collection. */
    async start(auth: AuthContext, batchId: string): Promise<CollectionStatusDto> {
      await failStaleRuns();
      const instagram = await access.load(batchId);
      const source = await repo.ensureSource({
        batchId,
        platform: 'instagram',
        externalAccountId: instagram.account.externalAccountId,
        username: instagram.account.username,
      });
      const run = await repo.startRun({
        sourceId: source.id,
        kind: source.initialCompletedAt ? 'update' : 'initial',
        startedById: auth.user.id,
      });
      if (!run) throw conflict('Pengambilan data untuk akun ini sedang berjalan.');
      // Runs in the background; the page follows it through the status endpoint.
      void execute(run, source, instagram);
      return status(batchId);
    },

    async runs(batchId: string): Promise<CollectionRunDto[]> {
      if (!(await batches.findById(batchId))) throw notFound('Ide tidak ditemukan.');
      const source = await viewSource(batchId);
      if (!source) return [];
      await failStaleRuns();
      return (await repo.listRuns(source.id, RUN_HISTORY_LIMIT)).map(toRunDto);
    },

    async posts(batchId: string): Promise<CollectedPostDto[]> {
      const source = await requireSource(batchId);
      const posts = await repo.listPosts(source.id);
      const refOf = await publisherRefs(batchId, posts);
      return posts.map((post) => ({
        id: post.id,
        externalMediaId: post.externalMediaId,
        caption: post.caption,
        permalink: post.permalink,
        thumbnailUrl: post.thumbnailUrl,
        postedAt: iso(post.postedAt),
        commentsCount: post.commentsCount,
        storedComments: post.storedComments,
        publisherItem: refOf(post),
      }));
    },

    async comments(batchId: string, query: CommentListQuery): Promise<CollectedCommentPageDto> {
      const source = await requireSource(batchId);
      const offset = (query.page - 1) * COMMENTS_PAGE_SIZE;
      const { rows, total } = await repo.listComments(
        source.id,
        { postId: query.postId, q: query.q || undefined, author: query.author },
        { limit: COMMENTS_PAGE_SIZE, offset },
      );
      const refOf = await publisherRefs(
        batchId,
        rows.map((row) => row.post),
      );
      return {
        items: rows.map(({ comment, post }) => ({
          id: comment.id,
          parentExternalId: comment.parentExternalId,
          username: comment.username,
          isFromAccount: comment.isFromAccount,
          text: comment.text,
          likeCount: comment.likeCount,
          commentedAt: comment.commentedAt.toISOString(),
          post: {
            id: post.id,
            caption: post.caption.slice(0, 300),
            permalink: post.permalink,
            thumbnailUrl: post.thumbnailUrl,
            postedAt: iso(post.postedAt),
            publisherItem: refOf(post),
          },
        })),
        page: query.page,
        pageSize: COMMENTS_PAGE_SIZE,
        total,
      };
    },

    async conversations(
      batchId: string,
      query: ConversationListQuery,
    ): Promise<DmConversationPageDto> {
      const source = await requireSource(batchId);
      const { rows, lastMessages, total } = await repo.listConversations(
        source.id,
        { q: query.q || undefined },
        { limit: CONVERSATIONS_PAGE_SIZE, offset: (query.page - 1) * CONVERSATIONS_PAGE_SIZE },
      );
      return {
        items: rows.map((row): DmConversationDto => {
          const last = lastMessages.find((message) => message.conversationId === row.id);
          return {
            id: row.id,
            participantUsername: row.participantUsername,
            lastMessageAt: iso(row.lastMessageAt),
            messageCount: row.messageCount,
            lastMessage: last ? toMessageDto(last) : null,
            possiblyIncomplete: row.possiblyIncomplete,
          };
        }),
        page: query.page,
        pageSize: CONVERSATIONS_PAGE_SIZE,
        total,
      };
    },

    async conversation(
      batchId: string,
      conversationId: string,
    ): Promise<DmConversationDetailResponse> {
      const source = await requireSource(batchId);
      const row = await repo.findConversation(source.id, conversationId);
      if (!row) throw notFound('Percakapan tidak ditemukan.');
      const messages = (await repo.listMessages(row.id)).map(toMessageDto);
      return {
        conversation: {
          id: row.id,
          participantUsername: row.participantUsername,
          lastMessageAt: iso(row.lastMessageAt),
          messageCount: messages.length,
          lastMessage: messages.at(-1) ?? null,
          possiblyIncomplete: row.possiblyIncomplete,
        },
        messages,
      };
    },
  };
}

export type CollectionService = ReturnType<typeof createCollectionService>;

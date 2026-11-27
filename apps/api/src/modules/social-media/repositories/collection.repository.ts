import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isUniqueViolation,
  lt,
  ne,
  or,
  smCollectedPosts,
  smCollectionRuns,
  smCollectionSources,
  smComments,
  smDmConversations,
  smDmMessages,
  sql,
  type DatabaseExecutor,
  type SmCollectedPostRow,
  type SmCollectionRunRow,
  type SmCollectionSourceRow,
  type SmCommentRow,
  type SmDmConversationRow,
  type SmDmMessageRow,
} from '@ai-preneur/database';

type Platform = SmCollectionSourceRow['platform'];

/** True for rows the upsert inserted (Postgres: xmax is 0 for a fresh row). */
const inserted = sql<boolean>`(xmax = 0)`;

/** `%text%` for ILIKE, with the wildcards of the search text escaped. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export interface SourceCounts {
  postCount: number;
  commentCount: number;
  conversationCount: number;
  messageCount: number;
  incompleteConversationCount: number;
}

export interface NewPost {
  externalMediaId: string;
  caption: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  mediaType: string | null;
  productType: string | null;
  postedAt: Date | null;
  commentsCount: number;
}

export type NewComment = Omit<SmCommentRow, 'id' | 'fetchedAt'>;
export type NewMessage = Omit<SmDmMessageRow, 'id' | 'fetchedAt'>;

export type RunPatch = Partial<
  Pick<
    SmCollectionRunRow,
    | 'status'
    | 'progressStage'
    | 'progressDetail'
    | 'newPosts'
    | 'newComments'
    | 'newConversations'
    | 'newMessages'
    | 'warnings'
    | 'errorMessage'
    | 'finishedAt'
  >
>;

export function createCollectionRepository(db: DatabaseExecutor) {
  return {
    // ---- Sources ----

    async findSource(
      batchId: string,
      platform: Platform,
      externalAccountId: string,
    ): Promise<SmCollectionSourceRow | undefined> {
      const [row] = await db
        .select()
        .from(smCollectionSources)
        .where(
          and(
            eq(smCollectionSources.batchId, batchId),
            eq(smCollectionSources.platform, platform),
            eq(smCollectionSources.externalAccountId, externalAccountId),
          ),
        )
        .limit(1);
      return row;
    },

    /** The most recently collected account of the idea on a platform (any account). */
    async findLatestSource(
      batchId: string,
      platform: Platform,
    ): Promise<SmCollectionSourceRow | undefined> {
      const [row] = await db
        .select()
        .from(smCollectionSources)
        .where(
          and(eq(smCollectionSources.batchId, batchId), eq(smCollectionSources.platform, platform)),
        )
        .orderBy(desc(smCollectionSources.updatedAt))
        .limit(1);
      return row;
    },

    async listSources(
      batchIds: readonly string[],
      platform: Platform,
    ): Promise<SmCollectionSourceRow[]> {
      if (batchIds.length === 0) return [];
      return db
        .select()
        .from(smCollectionSources)
        .where(
          and(
            inArray(smCollectionSources.batchId, [...batchIds]),
            eq(smCollectionSources.platform, platform),
          ),
        );
    },

    async ensureSource(values: {
      batchId: string;
      platform: Platform;
      externalAccountId: string;
      username: string | null;
    }): Promise<SmCollectionSourceRow> {
      const [row] = await db
        .insert(smCollectionSources)
        .values(values)
        .onConflictDoUpdate({
          target: [
            smCollectionSources.batchId,
            smCollectionSources.platform,
            smCollectionSources.externalAccountId,
          ],
          set: { username: values.username },
        })
        .returning();
      if (!row) throw new Error('Collection source upsert returned nothing');
      return row;
    },

    async updateSource(
      id: string,
      patch: Partial<
        Pick<
          SmCollectionSourceRow,
          'windowStart' | 'initialCompletedAt' | 'dmWatermark' | 'lastSucceededAt'
        >
      >,
    ): Promise<void> {
      await db.update(smCollectionSources).set(patch).where(eq(smCollectionSources.id, id));
    },

    async countsBySource(sourceIds: readonly string[]): Promise<Map<string, SourceCounts>> {
      const result = new Map<string, SourceCounts>();
      if (sourceIds.length === 0) return result;
      const ids = [...sourceIds];
      const [posts, comments, conversations, messages] = await Promise.all([
        db
          .select({ sourceId: smCollectedPosts.sourceId, value: count() })
          .from(smCollectedPosts)
          .where(inArray(smCollectedPosts.sourceId, ids))
          .groupBy(smCollectedPosts.sourceId),
        db
          .select({ sourceId: smComments.sourceId, value: count() })
          .from(smComments)
          .where(inArray(smComments.sourceId, ids))
          .groupBy(smComments.sourceId),
        db
          .select({
            sourceId: smDmConversations.sourceId,
            value: count(),
            incomplete: sql<number>`count(*) filter (where ${smDmConversations.possiblyIncomplete})::int`,
          })
          .from(smDmConversations)
          .where(inArray(smDmConversations.sourceId, ids))
          .groupBy(smDmConversations.sourceId),
        db
          .select({ sourceId: smDmMessages.sourceId, value: count() })
          .from(smDmMessages)
          .where(inArray(smDmMessages.sourceId, ids))
          .groupBy(smDmMessages.sourceId),
      ]);
      for (const sourceId of ids) {
        const conversation = conversations.find((row) => row.sourceId === sourceId);
        result.set(sourceId, {
          postCount: posts.find((row) => row.sourceId === sourceId)?.value ?? 0,
          commentCount: comments.find((row) => row.sourceId === sourceId)?.value ?? 0,
          conversationCount: conversation?.value ?? 0,
          messageCount: messages.find((row) => row.sourceId === sourceId)?.value ?? 0,
          incompleteConversationCount: conversation?.incomplete ?? 0,
        });
      }
      return result;
    },

    // ---- Runs ----

    /** Starts a run, or returns null when one is already running for the source. */
    async startRun(values: {
      sourceId: string;
      kind: SmCollectionRunRow['kind'];
      startedById: string | null;
    }): Promise<SmCollectionRunRow | null> {
      try {
        const [row] = await db.insert(smCollectionRuns).values(values).returning();
        return row ?? null;
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    /** Also refreshes the heartbeat. */
    async updateRun(id: string, patch: RunPatch): Promise<void> {
      await db
        .update(smCollectionRuns)
        .set({ ...patch, heartbeatAt: new Date() })
        .where(eq(smCollectionRuns.id, id));
    },

    /** Runs whose server stopped mid-way (no heartbeat since `before`) become failed. */
    async failStaleRuns(before: Date, message: string): Promise<void> {
      await db
        .update(smCollectionRuns)
        .set({ status: 'failed', errorMessage: message, finishedAt: new Date() })
        .where(
          and(eq(smCollectionRuns.status, 'running'), lt(smCollectionRuns.heartbeatAt, before)),
        );
    },

    async findRunning(sourceId: string): Promise<SmCollectionRunRow | undefined> {
      const [row] = await db
        .select()
        .from(smCollectionRuns)
        .where(and(eq(smCollectionRuns.sourceId, sourceId), eq(smCollectionRuns.status, 'running')))
        .limit(1);
      return row;
    },

    async findLastFinished(sourceId: string): Promise<SmCollectionRunRow | undefined> {
      const [row] = await db
        .select()
        .from(smCollectionRuns)
        .where(and(eq(smCollectionRuns.sourceId, sourceId), ne(smCollectionRuns.status, 'running')))
        .orderBy(desc(smCollectionRuns.startedAt))
        .limit(1);
      return row;
    },

    async listRuns(sourceId: string, limit: number): Promise<SmCollectionRunRow[]> {
      return db
        .select()
        .from(smCollectionRuns)
        .where(eq(smCollectionRuns.sourceId, sourceId))
        .orderBy(desc(smCollectionRuns.startedAt))
        .limit(limit);
    },

    async runningSourceIds(sourceIds: readonly string[]): Promise<Set<string>> {
      if (sourceIds.length === 0) return new Set();
      const rows = await db
        .select({ sourceId: smCollectionRuns.sourceId })
        .from(smCollectionRuns)
        .where(
          and(
            inArray(smCollectionRuns.sourceId, [...sourceIds]),
            eq(smCollectionRuns.status, 'running'),
          ),
        );
      return new Set(rows.map((row) => row.sourceId));
    },

    // ---- Posts ----

    /** Inserts new posts and refreshes known ones. Returns how many were new. */
    async upsertPosts(sourceId: string, posts: readonly NewPost[]): Promise<number> {
      if (posts.length === 0) return 0;
      const result = await db
        .insert(smCollectedPosts)
        .values(posts.map((post) => ({ ...post, sourceId })))
        .onConflictDoUpdate({
          target: [smCollectedPosts.sourceId, smCollectedPosts.externalMediaId],
          set: {
            caption: sql`excluded.caption`,
            permalink: sql`excluded.permalink`,
            thumbnailUrl: sql`excluded.thumbnail_url`,
            mediaType: sql`excluded.media_type`,
            productType: sql`excluded.product_type`,
            postedAt: sql`excluded.posted_at`,
            commentsCount: sql`excluded.comments_count`,
            updatedAt: new Date(),
          },
        })
        .returning({ inserted });
      return result.filter((entry) => entry.inserted).length;
    },

    /** Posts whose reported comment count differs from the count last read completely. */
    async listPostsToSync(sourceId: string): Promise<SmCollectedPostRow[]> {
      return db
        .select()
        .from(smCollectedPosts)
        .where(
          and(
            eq(smCollectedPosts.sourceId, sourceId),
            sql`${smCollectedPosts.commentsSyncedCount} is distinct from ${smCollectedPosts.commentsCount}`,
          ),
        )
        .orderBy(desc(smCollectedPosts.postedAt));
    },

    async markPostSynced(id: string, syncedCount: number): Promise<void> {
      await db
        .update(smCollectedPosts)
        .set({ commentsSyncedCount: syncedCount, commentsSyncedAt: new Date() })
        .where(eq(smCollectedPosts.id, id));
    },

    async listPosts(
      sourceId: string,
    ): Promise<Array<SmCollectedPostRow & { storedComments: number }>> {
      const stored = db
        .select({ postId: smComments.postId, value: count().as('value') })
        .from(smComments)
        .where(eq(smComments.sourceId, sourceId))
        .groupBy(smComments.postId)
        .as('stored');
      const rows = await db
        .select({ post: smCollectedPosts, storedComments: stored.value })
        .from(smCollectedPosts)
        .leftJoin(stored, eq(stored.postId, smCollectedPosts.id))
        .where(eq(smCollectedPosts.sourceId, sourceId))
        .orderBy(desc(smCollectedPosts.postedAt));
      return rows.map((row) => ({ ...row.post, storedComments: row.storedComments ?? 0 }));
    },

    async findPost(sourceId: string, postId: string): Promise<SmCollectedPostRow | undefined> {
      const [row] = await db
        .select()
        .from(smCollectedPosts)
        .where(and(eq(smCollectedPosts.sourceId, sourceId), eq(smCollectedPosts.id, postId)))
        .limit(1);
      return row;
    },

    // ---- Comments ----

    async countComments(postId: string): Promise<number> {
      const [row] = await db
        .select({ value: count() })
        .from(smComments)
        .where(eq(smComments.postId, postId));
      return row?.value ?? 0;
    },

    async knownCommentIds(sourceId: string, externalIds: readonly string[]): Promise<Set<string>> {
      if (externalIds.length === 0) return new Set();
      const rows = await db
        .select({ id: smComments.externalCommentId })
        .from(smComments)
        .where(
          and(
            eq(smComments.sourceId, sourceId),
            inArray(smComments.externalCommentId, [...externalIds]),
          ),
        );
      return new Set(rows.map((row) => row.id));
    },

    /** Inserts new comments; known ones get their text and like count refreshed. */
    async upsertComments(comments: readonly NewComment[]): Promise<number> {
      if (comments.length === 0) return 0;
      const result = await db
        .insert(smComments)
        .values([...comments])
        .onConflictDoUpdate({
          target: [smComments.sourceId, smComments.externalCommentId],
          set: { text: sql`excluded.text`, likeCount: sql`excluded.like_count` },
        })
        .returning({ inserted });
      return result.filter((entry) => entry.inserted).length;
    },

    async listComments(
      sourceId: string,
      filter: {
        postId?: string | undefined;
        q?: string | undefined;
        author: 'all' | 'audience' | 'account';
      },
      page: { limit: number; offset: number },
    ): Promise<{
      rows: Array<{ comment: SmCommentRow; post: SmCollectedPostRow }>;
      total: number;
    }> {
      const conditions = [eq(smComments.sourceId, sourceId)];
      if (filter.postId) conditions.push(eq(smComments.postId, filter.postId));
      if (filter.author === 'audience') conditions.push(eq(smComments.isFromAccount, false));
      if (filter.author === 'account') conditions.push(eq(smComments.isFromAccount, true));
      if (filter.q) {
        const pattern = likePattern(filter.q);
        const match = or(ilike(smComments.text, pattern), ilike(smComments.username, pattern));
        if (match) conditions.push(match);
      }
      const where = and(...conditions);
      const [rows, [total]] = await Promise.all([
        db
          .select({ comment: smComments, post: smCollectedPosts })
          .from(smComments)
          .innerJoin(smCollectedPosts, eq(smComments.postId, smCollectedPosts.id))
          .where(where)
          .orderBy(desc(smComments.commentedAt), desc(smComments.id))
          .limit(page.limit)
          .offset(page.offset),
        db.select({ value: count() }).from(smComments).where(where),
      ]);
      return { rows, total: total?.value ?? 0 };
    },

    // ---- DMs ----

    async upsertConversation(values: {
      sourceId: string;
      externalConversationId: string;
      participantExternalId: string | null;
      participantUsername: string | null;
      lastMessageAt: Date | null;
    }): Promise<{ id: string; possiblyIncomplete: boolean; inserted: boolean }> {
      const [result] = await db
        .insert(smDmConversations)
        .values(values)
        .onConflictDoUpdate({
          target: [smDmConversations.sourceId, smDmConversations.externalConversationId],
          set: {
            participantExternalId: values.participantExternalId,
            participantUsername: values.participantUsername,
            lastMessageAt: values.lastMessageAt,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: smDmConversations.id,
          possiblyIncomplete: smDmConversations.possiblyIncomplete,
          inserted,
        });
      if (!result) throw new Error('Conversation upsert returned nothing');
      return result;
    },

    async markConversationIncomplete(id: string): Promise<void> {
      await db
        .update(smDmConversations)
        .set({ possiblyIncomplete: true })
        .where(eq(smDmConversations.id, id));
    },

    async knownMessageIds(sourceId: string, externalIds: readonly string[]): Promise<Set<string>> {
      if (externalIds.length === 0) return new Set();
      const rows = await db
        .select({ id: smDmMessages.externalMessageId })
        .from(smDmMessages)
        .where(
          and(
            eq(smDmMessages.sourceId, sourceId),
            inArray(smDmMessages.externalMessageId, [...externalIds]),
          ),
        );
      return new Set(rows.map((row) => row.id));
    },

    async insertMessages(messages: readonly NewMessage[]): Promise<number> {
      if (messages.length === 0) return 0;
      const result = await db
        .insert(smDmMessages)
        .values([...messages])
        .onConflictDoNothing({ target: [smDmMessages.sourceId, smDmMessages.externalMessageId] })
        .returning({ id: smDmMessages.id });
      return result.length;
    },

    async listConversations(
      sourceId: string,
      filter: { q?: string | undefined },
      page: { limit: number; offset: number },
    ): Promise<{
      rows: Array<SmDmConversationRow & { messageCount: number }>;
      lastMessages: SmDmMessageRow[];
      total: number;
    }> {
      const conditions = [eq(smDmConversations.sourceId, sourceId)];
      if (filter.q) {
        const pattern = likePattern(filter.q);
        // Matches the participant or any message of the conversation.
        const match = or(
          ilike(smDmConversations.participantUsername, pattern),
          sql`exists (select 1 from ${smDmMessages} where ${smDmMessages.conversationId} = ${smDmConversations.id} and ${smDmMessages.text} ilike ${pattern})`,
        );
        if (match) conditions.push(match);
      }
      const where = and(...conditions);
      const counts = db
        .select({ conversationId: smDmMessages.conversationId, value: count().as('value') })
        .from(smDmMessages)
        .where(eq(smDmMessages.sourceId, sourceId))
        .groupBy(smDmMessages.conversationId)
        .as('counts');
      const [rows, [total]] = await Promise.all([
        db
          .select({ conversation: smDmConversations, messageCount: counts.value })
          .from(smDmConversations)
          .leftJoin(counts, eq(counts.conversationId, smDmConversations.id))
          .where(where)
          .orderBy(
            sql`${smDmConversations.lastMessageAt} desc nulls last`,
            desc(smDmConversations.id),
          )
          .limit(page.limit)
          .offset(page.offset),
        db.select({ value: count() }).from(smDmConversations).where(where),
      ]);
      const ids = rows.map((row) => row.conversation.id);
      const lastMessages =
        ids.length === 0
          ? []
          : await db
              .selectDistinctOn([smDmMessages.conversationId])
              .from(smDmMessages)
              .where(inArray(smDmMessages.conversationId, ids))
              .orderBy(smDmMessages.conversationId, desc(smDmMessages.sentAt));
      return {
        rows: rows.map((row) => ({ ...row.conversation, messageCount: row.messageCount ?? 0 })),
        lastMessages,
        total: total?.value ?? 0,
      };
    },

    async findConversation(sourceId: string, id: string): Promise<SmDmConversationRow | undefined> {
      const [row] = await db
        .select()
        .from(smDmConversations)
        .where(and(eq(smDmConversations.sourceId, sourceId), eq(smDmConversations.id, id)))
        .limit(1);
      return row;
    },

    async listMessages(conversationId: string): Promise<SmDmMessageRow[]> {
      return db
        .select()
        .from(smDmMessages)
        .where(eq(smDmMessages.conversationId, conversationId))
        .orderBy(smDmMessages.sentAt, smDmMessages.id);
    },
  };
}

export type CollectionRepository = ReturnType<typeof createCollectionRepository>;

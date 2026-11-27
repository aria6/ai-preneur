import { z } from 'zod';

import { performanceAccountSchema } from './social-performance.js';

/**
 * Social Media Analysis Engine — Data Collection AIgent.
 *
 * Collects the comments and DMs of each idea's connected accounts into the database,
 * incrementally: the first fetch ("Ambil data") reads the last COLLECTION_INITIAL_DAYS
 * days, every later one ("Perbarui data") only what is new since. Instagram only for now.
 */

/** How far back the first fetch reads posts (and DM conversations). */
export const COLLECTION_INITIAL_DAYS = 90;
/** Instagram returns only the latest messages of a conversation. */
export const DM_READABLE_MESSAGES = 20;

export const COLLECTION_RUN_KINDS = ['initial', 'update'] as const;
export const COLLECTION_RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;
/** Steps of a running collection, in order. */
export const COLLECTION_STAGES = ['posts', 'comments', 'dms'] as const;
export type CollectionStage = (typeof COLLECTION_STAGES)[number];

const isoDate = z.string();
const nullableIso = isoDate.nullable();

export const publisherItemRefSchema = z.object({
  topicNumber: z.number().int(),
  partNumber: z.number().int().nullable(),
  title: z.string(),
});

// ---- Runs --------------------------------------------------------------------------

export const collectionRunSchema = z.object({
  id: z.string(),
  kind: z.enum(COLLECTION_RUN_KINDS),
  status: z.enum(COLLECTION_RUN_STATUSES),
  progressStage: z.enum(COLLECTION_STAGES).nullable(),
  progressDetail: z.string().nullable(),
  newPosts: z.number().int(),
  newComments: z.number().int(),
  newConversations: z.number().int(),
  newMessages: z.number().int(),
  warnings: z.array(z.string()),
  errorMessage: z.string().nullable(),
  startedAt: isoDate,
  finishedAt: nullableIso,
});
export type CollectionRunDto = z.infer<typeof collectionRunSchema>;

export const collectionRunListResponseSchema = z.object({ items: z.array(collectionRunSchema) });
export type CollectionRunListResponse = z.infer<typeof collectionRunListResponseSchema>;

// ---- What has been collected for an account ------------------------------------------

export const collectionSummarySchema = z.object({
  username: z.string().nullable(),
  /** Oldest post time covered. */
  windowStart: nullableIso,
  /** Null until the first fetch finished: the button says "Ambil data". */
  initialCompletedAt: nullableIso,
  lastSucceededAt: nullableIso,
  /** DMs read at least once. */
  dmCollected: z.boolean(),
  postCount: z.number().int(),
  commentCount: z.number().int(),
  conversationCount: z.number().int(),
  messageCount: z.number().int(),
  /** Conversations whose older messages could not be read. */
  incompleteConversationCount: z.number().int(),
});
export type CollectionSummaryDto = z.infer<typeof collectionSummarySchema>;

export const analysisIdeaSchema = z.object({
  id: z.string(),
  ideaNumber: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  archivedAt: nullableIso,
  accounts: z.array(performanceAccountSchema),
  /** Instagram data collected so far (null = nothing collected yet). */
  instagram: collectionSummarySchema.nullable(),
  instagramRunning: z.boolean(),
});
export type AnalysisIdeaDto = z.infer<typeof analysisIdeaSchema>;

export const analysisIdeaListResponseSchema = z.object({ items: z.array(analysisIdeaSchema) });
export type AnalysisIdeaListResponse = z.infer<typeof analysisIdeaListResponseSchema>;

export const analysisIdeaResponseSchema = z.object({ idea: analysisIdeaSchema });
export type AnalysisIdeaResponse = z.infer<typeof analysisIdeaResponseSchema>;

/** State of one idea's Instagram collection: shown above the data, polled while running. */
export const collectionStatusSchema = z.object({
  summary: collectionSummarySchema.nullable(),
  /** The running collection, if any. */
  currentRun: collectionRunSchema.nullable(),
  /** The latest finished collection. */
  lastRun: collectionRunSchema.nullable(),
  /** Why a collection cannot start now (no account, account in error, …). */
  blockedReason: z.string().nullable(),
  /** Next press: the first fetch or an update. */
  nextKind: z.enum(COLLECTION_RUN_KINDS),
});
export type CollectionStatusDto = z.infer<typeof collectionStatusSchema>;

export const collectionStatusResponseSchema = z.object({ status: collectionStatusSchema });
export type CollectionStatusResponse = z.infer<typeof collectionStatusResponseSchema>;

// ---- Collected data ------------------------------------------------------------------

const pageQuery = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  q: z.string().trim().max(200).optional(),
};

export const COMMENT_AUTHOR_FILTERS = ['all', 'audience', 'account'] as const;
export type CommentAuthorFilter = (typeof COMMENT_AUTHOR_FILTERS)[number];

export const commentListQuerySchema = z.object({
  ...pageQuery,
  postId: z.uuid({ error: 'Post tidak valid' }).optional(),
  /** audience = everyone except the idea's own account. */
  author: z.enum(COMMENT_AUTHOR_FILTERS).default('all'),
});
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;

export const collectedPostSchema = z.object({
  id: z.string(),
  externalMediaId: z.string(),
  caption: z.string(),
  permalink: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  postedAt: nullableIso,
  /** comments_count reported by the platform on the last fetch. */
  commentsCount: z.number().int(),
  storedComments: z.number().int(),
  publisherItem: publisherItemRefSchema.nullable(),
});
export type CollectedPostDto = z.infer<typeof collectedPostSchema>;

export const collectedPostListResponseSchema = z.object({ items: z.array(collectedPostSchema) });
export type CollectedPostListResponse = z.infer<typeof collectedPostListResponseSchema>;

export const collectedCommentSchema = z.object({
  id: z.string(),
  parentExternalId: z.string().nullable(),
  username: z.string().nullable(),
  isFromAccount: z.boolean(),
  text: z.string(),
  likeCount: z.number().int().nullable(),
  commentedAt: isoDate,
  post: z.object({
    id: z.string(),
    caption: z.string(),
    permalink: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
    postedAt: nullableIso,
    publisherItem: publisherItemRefSchema.nullable(),
  }),
});
export type CollectedCommentDto = z.infer<typeof collectedCommentSchema>;

export const collectedCommentPageSchema = z.object({
  items: z.array(collectedCommentSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type CollectedCommentPageDto = z.infer<typeof collectedCommentPageSchema>;

export const conversationListQuerySchema = z.object(pageQuery);
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const dmMessageSchema = z.object({
  id: z.string(),
  isFromAccount: z.boolean(),
  senderUsername: z.string().nullable(),
  text: z.string(),
  attachmentTypes: z.array(z.string()),
  sentAt: isoDate,
});
export type DmMessageDto = z.infer<typeof dmMessageSchema>;

export const dmConversationSchema = z.object({
  id: z.string(),
  participantUsername: z.string().nullable(),
  lastMessageAt: nullableIso,
  messageCount: z.number().int(),
  lastMessage: dmMessageSchema.nullable(),
  possiblyIncomplete: z.boolean(),
});
export type DmConversationDto = z.infer<typeof dmConversationSchema>;

export const dmConversationPageSchema = z.object({
  items: z.array(dmConversationSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type DmConversationPageDto = z.infer<typeof dmConversationPageSchema>;

export const dmConversationDetailResponseSchema = z.object({
  conversation: dmConversationSchema,
  /** Oldest first. */
  messages: z.array(dmMessageSchema),
});
export type DmConversationDetailResponse = z.infer<typeof dmConversationDetailResponseSchema>;

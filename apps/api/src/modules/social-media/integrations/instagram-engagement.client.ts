import { z } from 'zod';

import { graphRequest, InstagramApiError } from './instagram.client.js';
import { isMissingPermission } from './instagram-insights.client.js';

/**
 * Read-only comments and DMs of an Instagram professional account (Data Collection
 * AIgent). Works with both token kinds:
 * - comments need `instagram_manage_comments` (Unified login) or
 *   `instagram_business_manage_comments` (Instagram Login);
 * - DMs need `instagram_manage_messages` / `instagram_business_manage_messages`.
 *
 * Platform limits the caller has to live with:
 * - comments can't be filtered by time and come at most 50 per page;
 * - only the 20 latest messages of a conversation can be read.
 */

const COMMENTS_PER_PAGE = 50;
const CONVERSATIONS_PER_PAGE = 25;
const MESSAGES_PER_CONVERSATION = 20;

/** Errors worth retrying with fewer fields (an unsupported field), not fatal ones. */
function isFieldProblem(error: unknown): boolean {
  return (
    error instanceof InstagramApiError &&
    !error.tokenInvalid &&
    !error.retryable &&
    !isMissingPermission(error)
  );
}

/** Asks with the full field list; if Instagram refuses a field, asks with the basic one. */
async function requestWithFallback(
  path: string,
  accessToken: string,
  params: Record<string, string>,
  fields: { full: string; basic: string },
  action: string,
): Promise<unknown> {
  try {
    return await graphRequest('GET', path, accessToken, { ...params, fields: fields.full }, action);
  } catch (error) {
    if (!isFieldProblem(error)) throw error;
    return graphRequest('GET', path, accessToken, { ...params, fields: fields.basic }, action);
  }
}

const id = z.union([z.string(), z.number()]).transform(String);
const paging = z
  .object({
    cursors: z.object({ after: z.string().optional() }).optional(),
    next: z.string().optional(),
  })
  .optional();
const nextCursor = (value: z.infer<typeof paging>) =>
  value?.next ? (value.cursors?.after ?? null) : null;

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toCount(value: unknown): number | null {
  const parsed = z.coerce.number().int().safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ---- Comments --------------------------------------------------------------------

const author = z.object({ id: id.optional(), username: z.string().optional() }).optional();

const commentFields = {
  id,
  text: z.string().optional(),
  timestamp: z.string().optional(),
  username: z.string().optional(),
  like_count: z.unknown().optional(),
  from: author,
};
const commentSchema = z.object({
  ...commentFields,
  replies: z.object({ data: z.array(z.object(commentFields)).default([]), paging }).optional(),
});
const commentPageSchema = z.object({ data: z.array(commentSchema).default([]), paging });
const replyPageSchema = z.object({ data: z.array(z.object(commentFields)).default([]), paging });

export interface InstagramComment {
  id: string;
  /** Top-level comment this one replies to (null for top-level comments). */
  parentId: string | null;
  text: string;
  commentedAt: Date;
  username: string | null;
  authorId: string | null;
  likeCount: number | null;
}

const COMMENT_FIELDS_FULL = 'id,text,timestamp,username,like_count,from';
const COMMENT_FIELDS_BASIC = 'id,text,timestamp,username,like_count';
const replies = (fields: string) => `replies.limit(${COMMENTS_PER_PAGE}){${fields}}`;

function toComment(
  raw: z.infer<typeof replyPageSchema>['data'][number],
  parentId: string | null,
): InstagramComment | null {
  const commentedAt = toDate(raw.timestamp);
  if (!commentedAt) return null;
  return {
    id: raw.id,
    parentId,
    text: raw.text ?? '',
    commentedAt,
    username: raw.from?.username ?? raw.username ?? null,
    authorId: raw.from?.id ?? null,
    likeCount: toCount(raw.like_count),
  };
}

async function listReplies(
  accessToken: string,
  commentId: string,
  after: string | null,
): Promise<{ replies: InstagramComment[]; nextCursor: string | null }> {
  const params: Record<string, string> = { limit: String(COMMENTS_PER_PAGE) };
  if (after) params.after = after;
  const body = await requestWithFallback(
    `/${commentId}/replies`,
    accessToken,
    params,
    { full: COMMENT_FIELDS_FULL, basic: COMMENT_FIELDS_BASIC },
    'membaca balasan komentar',
  );
  const parsed = replyPageSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (balasan).');
  return {
    replies: parsed.data.data.flatMap((raw) => toComment(raw, commentId) ?? []),
    nextCursor: nextCursor(parsed.data.paging),
  };
}

/**
 * One page of a post's comments with their replies (replies flattened after their
 * comment). Replies beyond the first page of a comment are fetched here as well.
 */
export async function listComments(
  accessToken: string,
  mediaId: string,
  after: string | null,
): Promise<{ comments: InstagramComment[]; nextCursor: string | null }> {
  const params: Record<string, string> = { limit: String(COMMENTS_PER_PAGE) };
  if (after) params.after = after;
  const body = await requestWithFallback(
    `/${mediaId}/comments`,
    accessToken,
    params,
    {
      full: `${COMMENT_FIELDS_FULL},${replies(COMMENT_FIELDS_FULL)}`,
      basic: `${COMMENT_FIELDS_BASIC},${replies(COMMENT_FIELDS_BASIC)}`,
    },
    'membaca komentar',
  );
  const parsed = commentPageSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (komentar).');

  const comments: InstagramComment[] = [];
  for (const raw of parsed.data.data) {
    const comment = toComment(raw, null);
    if (!comment) continue;
    comments.push(comment);
    for (const reply of raw.replies?.data ?? []) {
      const parsedReply = toComment(reply, comment.id);
      if (parsedReply) comments.push(parsedReply);
    }
    let cursor = nextCursor(raw.replies?.paging);
    while (cursor) {
      const page = await listReplies(accessToken, comment.id, cursor);
      comments.push(...page.replies);
      cursor = page.nextCursor;
    }
  }
  return { comments, nextCursor: nextCursor(parsed.data.paging) };
}

// ---- DMs -------------------------------------------------------------------------

const participantSchema = z.object({ id: id.optional(), username: z.string().optional() });

const conversationPageSchema = z.object({
  data: z
    .array(
      z.object({
        id,
        updated_time: z.string().optional(),
        participants: z.object({ data: z.array(participantSchema).default([]) }).optional(),
      }),
    )
    .default([]),
  paging,
});

export interface InstagramParticipant {
  id: string | null;
  username: string | null;
}

export interface InstagramConversation {
  id: string;
  updatedAt: Date | null;
  participants: InstagramParticipant[];
}

/** One page of the account's conversations, most recently active first. */
export async function listConversations(
  accessToken: string,
  igUserId: string,
  after: string | null,
): Promise<{ conversations: InstagramConversation[]; nextCursor: string | null }> {
  const params: Record<string, string> = {
    platform: 'instagram',
    fields: 'id,updated_time,participants',
    limit: String(CONVERSATIONS_PER_PAGE),
  };
  if (after) params.after = after;
  const body = await graphRequest(
    'GET',
    `/${igUserId}/conversations`,
    accessToken,
    params,
    'membaca daftar DM',
  );
  const parsed = conversationPageSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (DM).');
  return {
    conversations: parsed.data.data.map((raw) => ({
      id: raw.id,
      updatedAt: toDate(raw.updated_time),
      participants: (raw.participants?.data ?? []).map((participant) => ({
        id: participant.id ?? null,
        username: participant.username ?? null,
      })),
    })),
    nextCursor: nextCursor(parsed.data.paging),
  };
}

const messageSchema = z.object({
  id,
  created_time: z.string().optional(),
  message: z.string().optional(),
  from: participantSchema.optional(),
  attachments: z
    .object({ data: z.array(z.record(z.string(), z.unknown())).default([]) })
    .optional(),
  shares: z.unknown().optional(),
  story: z.unknown().optional(),
  is_unsupported: z.boolean().optional(),
});
const conversationMessagesSchema = z.object({
  messages: z.object({ data: z.array(messageSchema).default([]), paging }).optional(),
});

export interface InstagramMessage {
  id: string;
  sentAt: Date;
  text: string;
  sender: InstagramParticipant;
  /** image, video, audio, file, share, story, unsupported, other */
  attachmentTypes: string[];
}

const messageFields = (fields: string) => `messages.limit(${MESSAGES_PER_CONVERSATION}){${fields}}`;

const ATTACHMENT_KEYS: ReadonlyArray<[key: string, type: string]> = [
  ['image_data', 'image'],
  ['video_data', 'video'],
  ['audio_data', 'audio'],
  ['file_url', 'file'],
];

function attachmentTypes(raw: z.infer<typeof messageSchema>): string[] {
  const types = new Set<string>();
  for (const attachment of raw.attachments?.data ?? []) {
    const match = ATTACHMENT_KEYS.find(([key]) => key in attachment);
    types.add(match ? match[1] : 'other');
  }
  if (raw.shares) types.add('share');
  if (raw.story) types.add('story');
  if (raw.is_unsupported) types.add('unsupported');
  return [...types];
}

/**
 * The latest messages of a conversation (Instagram gives details only for the 20 most
 * recent). `hasOlder` = the conversation has more messages than could be read.
 */
export async function getConversationMessages(
  accessToken: string,
  conversationId: string,
): Promise<{ messages: InstagramMessage[]; hasOlder: boolean }> {
  const body = await requestWithFallback(
    `/${conversationId}`,
    accessToken,
    {},
    {
      full: messageFields('id,created_time,from,message,attachments,shares,story,is_unsupported'),
      basic: messageFields('id,created_time,from,message'),
    },
    'membaca isi DM',
  );
  const parsed = conversationMessagesSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (isi DM).');
  return {
    messages: (parsed.data.messages?.data ?? []).flatMap((raw): InstagramMessage[] => {
      const sentAt = toDate(raw.created_time);
      if (!sentAt) return [];
      return [
        {
          id: raw.id,
          sentAt,
          text: raw.message ?? '',
          sender: { id: raw.from?.id ?? null, username: raw.from?.username ?? null },
          attachmentTypes: attachmentTypes(raw),
        },
      ];
    }),
    hasOlder: Boolean(parsed.data.messages?.paging?.next),
  };
}

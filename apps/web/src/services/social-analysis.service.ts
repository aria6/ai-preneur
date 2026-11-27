import {
  analysisIdeaListResponseSchema,
  analysisIdeaResponseSchema,
  collectedCommentPageSchema,
  collectedPostListResponseSchema,
  collectionRunListResponseSchema,
  collectionStatusResponseSchema,
  dmConversationDetailResponseSchema,
  dmConversationPageSchema,
  type AnalysisIdeaDto,
  type CollectedCommentPageDto,
  type CollectedPostDto,
  type CollectionRunDto,
  type CollectionStatusDto,
  type CommentAuthorFilter,
  type DmConversationDetailResponse,
  type DmConversationPageDto,
  type IdeaListFilter,
} from '@ai-preneur/shared';

import { apiClient } from './api-client';

const ideaUrl = (id: string) => `/social/analysis/ideas/${encodeURIComponent(id)}`;
const instagramUrl = (id: string) => `${ideaUrl(id)}/instagram`;

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.size > 0 ? `${path}?${query.toString()}` : path;
}

export async function listAnalysisIdeas(
  filter: IdeaListFilter,
  signal?: AbortSignal,
): Promise<AnalysisIdeaDto[]> {
  return (
    await apiClient.get(`/social/analysis/ideas?filter=${filter}`, {
      schema: analysisIdeaListResponseSchema,
      signal: signal ?? null,
    })
  ).items;
}

export async function getAnalysisIdea(id: string, signal?: AbortSignal): Promise<AnalysisIdeaDto> {
  return (
    await apiClient.get(ideaUrl(id), { schema: analysisIdeaResponseSchema, signal: signal ?? null })
  ).idea;
}

export async function getCollectionStatus(
  id: string,
  signal?: AbortSignal,
): Promise<CollectionStatusDto> {
  return (
    await apiClient.get(`${instagramUrl(id)}/status`, {
      schema: collectionStatusResponseSchema,
      signal: signal ?? null,
    })
  ).status;
}

/** "Ambil data" / "Perbarui data". */
export async function startCollection(id: string): Promise<CollectionStatusDto> {
  return (
    await apiClient.post(`${instagramUrl(id)}/collect`, {
      schema: collectionStatusResponseSchema,
    })
  ).status;
}

export async function listCollectionRuns(
  id: string,
  signal?: AbortSignal,
): Promise<CollectionRunDto[]> {
  return (
    await apiClient.get(`${instagramUrl(id)}/runs`, {
      schema: collectionRunListResponseSchema,
      signal: signal ?? null,
    })
  ).items;
}

export async function listCollectedPosts(
  id: string,
  signal?: AbortSignal,
): Promise<CollectedPostDto[]> {
  return (
    await apiClient.get(`${instagramUrl(id)}/posts`, {
      schema: collectedPostListResponseSchema,
      signal: signal ?? null,
    })
  ).items;
}

export async function listCollectedComments(
  id: string,
  options: {
    page: number;
    q?: string;
    postId?: string;
    author: CommentAuthorFilter;
    signal?: AbortSignal;
  },
): Promise<CollectedCommentPageDto> {
  return apiClient.get(
    withQuery(`${instagramUrl(id)}/comments`, {
      page: options.page,
      q: options.q,
      postId: options.postId,
      author: options.author === 'all' ? undefined : options.author,
    }),
    { schema: collectedCommentPageSchema, signal: options.signal ?? null },
  );
}

export async function listConversations(
  id: string,
  options: { page: number; q?: string; signal?: AbortSignal },
): Promise<DmConversationPageDto> {
  return apiClient.get(
    withQuery(`${instagramUrl(id)}/conversations`, { page: options.page, q: options.q }),
    { schema: dmConversationPageSchema, signal: options.signal ?? null },
  );
}

export async function getConversation(
  id: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<DmConversationDetailResponse> {
  return apiClient.get(`${instagramUrl(id)}/conversations/${encodeURIComponent(conversationId)}`, {
    schema: dmConversationDetailResponseSchema,
    signal: signal ?? null,
  });
}

import {
  instagramMediaPageSchema,
  instagramOverviewResponseSchema,
  performanceIdeaListResponseSchema,
  performanceIdeaResponseSchema,
  type InstagramMediaPageDto,
  type InstagramOverviewDto,
  type PerformanceIdeaDto,
  type PerformanceRangeDays,
} from '@ai-preneur/shared';

import { apiClient } from './api-client';

const ideaUrl = (id: string) => `/social/performance/ideas/${encodeURIComponent(id)}`;

export async function listPerformanceIdeas(signal?: AbortSignal): Promise<PerformanceIdeaDto[]> {
  return (
    await apiClient.get('/social/performance/ideas', {
      schema: performanceIdeaListResponseSchema,
      signal: signal ?? null,
    })
  ).items;
}

export async function getPerformanceIdea(
  id: string,
  signal?: AbortSignal,
): Promise<PerformanceIdeaDto> {
  return (
    await apiClient.get(ideaUrl(id), {
      schema: performanceIdeaResponseSchema,
      signal: signal ?? null,
    })
  ).idea;
}

export async function getInstagramOverview(
  id: string,
  options: { days: PerformanceRangeDays; refresh?: boolean; signal?: AbortSignal },
): Promise<InstagramOverviewDto> {
  const query = new URLSearchParams({ days: String(options.days) });
  if (options.refresh) query.set('refresh', 'true');
  return (
    await apiClient.get(`${ideaUrl(id)}/instagram/overview?${query.toString()}`, {
      schema: instagramOverviewResponseSchema,
      signal: options.signal ?? null,
    })
  ).overview;
}

export async function getInstagramMedia(
  id: string,
  options: { after?: string | null; refresh?: boolean; signal?: AbortSignal } = {},
): Promise<InstagramMediaPageDto> {
  const query = new URLSearchParams();
  if (options.after) query.set('after', options.after);
  if (options.refresh) query.set('refresh', 'true');
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiClient.get(`${ideaUrl(id)}/instagram/media${suffix}`, {
    schema: instagramMediaPageSchema,
    signal: options.signal ?? null,
  });
}

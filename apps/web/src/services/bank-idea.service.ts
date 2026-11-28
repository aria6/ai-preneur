import {
  bankIdeaDetailResponseSchema,
  bankIdeaListResponseSchema,
  bankIdeaResearchStatusResponseSchema,
  bankIdeaResponseSchema,
  structureBankIdeaResponseSchema,
  type BankIdeaDetailResponse,
  type BankIdeaDraft,
  type BankIdeaDto,
  type BankIdeaListFilter,
  type BankIdeaResearchStatusResponse,
  type BankIdeaSummaryDto,
  type CreateBankIdeaRequest,
  type UpdateBankIdeaRequest,
} from '@ai-preneur/shared';

import { apiClient } from './api-client';

const ideaUrl = (id: string) => `/bank-ideas/${encodeURIComponent(id)}`;

export async function listIdeas(
  filter: BankIdeaListFilter,
  signal?: AbortSignal,
): Promise<BankIdeaSummaryDto[]> {
  return (
    await apiClient.get(`/bank-ideas?filter=${filter}`, {
      schema: bankIdeaListResponseSchema,
      signal: signal ?? null,
    })
  ).items;
}

export async function getIdea(id: string, signal?: AbortSignal): Promise<BankIdeaDetailResponse> {
  return apiClient.get(ideaUrl(id), {
    schema: bankIdeaDetailResponseSchema,
    signal: signal ?? null,
  });
}

export async function structureIdea(rawInput: string): Promise<BankIdeaDraft> {
  return (
    await apiClient.post('/bank-ideas/structure', {
      body: { rawInput },
      schema: structureBankIdeaResponseSchema,
    })
  ).draft;
}

export async function createIdea(input: CreateBankIdeaRequest): Promise<BankIdeaDto> {
  return (await apiClient.post('/bank-ideas', { body: input, schema: bankIdeaResponseSchema }))
    .idea;
}

export async function updateIdea(id: string, input: UpdateBankIdeaRequest): Promise<BankIdeaDto> {
  return (await apiClient.patch(ideaUrl(id), { body: input, schema: bankIdeaResponseSchema })).idea;
}

export async function setArchived(id: string, archived: boolean): Promise<BankIdeaDto> {
  return (
    await apiClient.post(`${ideaUrl(id)}/${archived ? 'archive' : 'unarchive'}`, {
      schema: bankIdeaResponseSchema,
    })
  ).idea;
}

export async function deleteIdea(id: string): Promise<void> {
  await apiClient.delete(ideaUrl(id));
}

export async function startResearch(
  id: string,
  focusSegment?: string,
): Promise<BankIdeaResearchStatusResponse> {
  return apiClient.post(`${ideaUrl(id)}/research`, {
    body: focusSegment ? { focusSegment } : {},
    schema: bankIdeaResearchStatusResponseSchema,
  });
}

export async function getResearchStatus(
  id: string,
  signal?: AbortSignal,
): Promise<BankIdeaResearchStatusResponse> {
  return apiClient.get(`${ideaUrl(id)}/research/status`, {
    schema: bankIdeaResearchStatusResponseSchema,
    signal: signal ?? null,
  });
}

export async function cancelResearch(
  id: string,
  runId: string,
): Promise<BankIdeaResearchStatusResponse> {
  return apiClient.post(`${ideaUrl(id)}/research/${encodeURIComponent(runId)}/cancel`, {
    schema: bankIdeaResearchStatusResponseSchema,
  });
}

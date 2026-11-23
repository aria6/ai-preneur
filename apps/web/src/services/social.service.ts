import {
  batchListResponseSchema,
  batchResponseSchema,
  scanResponseSchema,
  socialSettingsResponseSchema,
  type AutoScheduleRequest,
  type BatchDetailDto,
  type BatchSummaryDto,
  type CreateBatchRequest,
  type CreateItemRequest,
  type ResumeItemRequest,
  type ScanResponse,
  type SocialPlatform,
  type SocialSettings,
  type UpdateBatchRequest,
  type UpdateItemRequest,
  type UpdateSocialSettingsRequest,
} from '@ai-preneur/shared';

import { apiClient } from './api-client';

const batchUrl = (id: string) => `/social/batches/${encodeURIComponent(id)}`;
const itemUrl = (batchId: string, itemId: string) => `${batchUrl(batchId)}/items/${encodeURIComponent(itemId)}`;

async function batchCall(promise: Promise<{ batch: BatchDetailDto }>): Promise<BatchDetailDto> {
  return (await promise).batch;
}

// ---- Settings ----

export async function getSocialSettings(signal?: AbortSignal): Promise<SocialSettings> {
  return (await apiClient.get('/social/settings', { schema: socialSettingsResponseSchema, signal: signal ?? null }))
    .settings;
}

export async function updateSocialSettings(input: UpdateSocialSettingsRequest): Promise<SocialSettings> {
  return (await apiClient.put('/social/settings', { body: input, schema: socialSettingsResponseSchema })).settings;
}

// ---- Batches ----

export async function listBatches(signal?: AbortSignal): Promise<BatchSummaryDto[]> {
  return (await apiClient.get('/social/batches', { schema: batchListResponseSchema, signal: signal ?? null })).items;
}

export function getBatch(id: string, signal?: AbortSignal): Promise<BatchDetailDto> {
  return batchCall(apiClient.get(batchUrl(id), { schema: batchResponseSchema, signal: signal ?? null }));
}

export function createBatch(input: CreateBatchRequest): Promise<BatchDetailDto> {
  return batchCall(apiClient.post('/social/batches', { body: input, schema: batchResponseSchema }));
}

export function updateBatch(id: string, input: UpdateBatchRequest): Promise<BatchDetailDto> {
  return batchCall(apiClient.patch(batchUrl(id), { body: input, schema: batchResponseSchema }));
}

export async function deleteBatch(id: string): Promise<void> {
  await apiClient.delete(batchUrl(id));
}

export function scanBatch(id: string): Promise<ScanResponse> {
  return apiClient.post(`${batchUrl(id)}/scan`, { schema: scanResponseSchema });
}

export function autoScheduleBatch(id: string, input: AutoScheduleRequest): Promise<BatchDetailDto> {
  return batchCall(apiClient.post(`${batchUrl(id)}/auto-schedule`, { body: input, schema: batchResponseSchema }));
}

export function reorderBatchItems(id: string, itemIds: string[]): Promise<BatchDetailDto> {
  return batchCall(apiClient.put(`${batchUrl(id)}/order`, { body: { itemIds }, schema: batchResponseSchema }));
}

export function confirmBatch(id: string): Promise<BatchDetailDto> {
  return batchCall(apiClient.post(`${batchUrl(id)}/confirm`, { schema: batchResponseSchema }));
}

export function cancelBatchSchedule(id: string): Promise<BatchDetailDto> {
  return batchCall(apiClient.post(`${batchUrl(id)}/cancel`, { schema: batchResponseSchema }));
}

// ---- Queue rows ----

export function createItem(batchId: string, input: CreateItemRequest): Promise<BatchDetailDto> {
  return batchCall(apiClient.post(`${batchUrl(batchId)}/items`, { body: input, schema: batchResponseSchema }));
}

export function updateItem(batchId: string, itemId: string, input: UpdateItemRequest): Promise<BatchDetailDto> {
  return batchCall(apiClient.patch(itemUrl(batchId, itemId), { body: input, schema: batchResponseSchema }));
}

export function deleteItem(batchId: string, itemId: string): Promise<BatchDetailDto> {
  return batchCall(apiClient.delete(itemUrl(batchId, itemId), { schema: batchResponseSchema }));
}

export function pauseItem(batchId: string, itemId: string): Promise<BatchDetailDto> {
  return batchCall(apiClient.post(`${itemUrl(batchId, itemId)}/pause`, { schema: batchResponseSchema }));
}

export function resumeItem(batchId: string, itemId: string, input: ResumeItemRequest): Promise<BatchDetailDto> {
  return batchCall(apiClient.post(`${itemUrl(batchId, itemId)}/resume`, { body: input, schema: batchResponseSchema }));
}

// ---- Accounts ----

export function connectInstagram(batchId: string, accessToken: string): Promise<BatchDetailDto> {
  return batchCall(
    apiClient.put(`${batchUrl(batchId)}/accounts/instagram`, { body: { accessToken }, schema: batchResponseSchema }),
  );
}

export function disconnectAccount(batchId: string, platform: SocialPlatform): Promise<BatchDetailDto> {
  return batchCall(
    apiClient.delete(`${batchUrl(batchId)}/accounts/${encodeURIComponent(platform)}`, { schema: batchResponseSchema }),
  );
}

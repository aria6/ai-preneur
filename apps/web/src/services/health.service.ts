import { healthResponseSchema, type HealthResponse } from '@ai-preneur/shared';

import { apiClient } from './api-client';

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiClient.get('/health', { schema: healthResponseSchema, signal: signal ?? null });
}

import type { ApiResponse, ErrorCode } from '@ai-preneur/shared';
import type { ZodType } from 'zod';

import { env } from '../app/env';

export type ApiClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiClientErrorCode;
  readonly details: unknown;

  constructor(message: string, status: number, code: ApiClientErrorCode, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions<T> extends Omit<RequestInit, 'body' | 'method'> {
  /** JSON-serializable request body. */
  body?: unknown;
  /** Optional Zod schema (usually from @ai-preneur/shared) to validate `data` at runtime. */
  schema?: ZodType<T>;
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  return typeof value === 'object' && value !== null && 'success' in value;
}

async function request<T>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { body, schema, headers, ...init } = options;

  const finalHeaders = new Headers(headers);
  finalHeaders.set('Accept', 'application/json');
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      ...init,
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError('Unable to reach the API', 0, 'NETWORK_ERROR', error);
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      `Unexpected non-JSON response (HTTP ${response.status})`,
      response.status,
      'INVALID_RESPONSE',
    );
  }

  if (!isApiResponse(payload)) {
    throw new ApiClientError('Response does not follow the API envelope', response.status, 'INVALID_RESPONSE');
  }

  if (!payload.success) {
    throw new ApiClientError(
      payload.error.message,
      response.status,
      payload.error.code,
      payload.error.details,
    );
  }

  if (!schema) return payload.data as T;

  const parsed = schema.safeParse(payload.data);
  if (!parsed.success) {
    throw new ApiClientError(
      'Response data does not match the expected contract',
      response.status,
      'INVALID_RESPONSE',
      parsed.error.issues,
    );
  }
  return parsed.data;
}

/**
 * Single HTTP entry point for the frontend. Feature services wrap these calls;
 * components and hooks never call `fetch` directly.
 */
export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions<T>, 'body'>) => request<T>('GET', path, options),
  post: <T>(path: string, options?: RequestOptions<T>) => request<T>('POST', path, options),
  put: <T>(path: string, options?: RequestOptions<T>) => request<T>('PUT', path, options),
  patch: <T>(path: string, options?: RequestOptions<T>) => request<T>('PATCH', path, options),
  delete: <T>(path: string, options?: RequestOptions<T>) => request<T>('DELETE', path, options),
};

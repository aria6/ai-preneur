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

export interface RequestOptions<T> extends Omit<RequestInit, 'body' | 'method' | 'credentials'> {
  /** JSON-serializable request body. */
  body?: unknown;
  /** Optional Zod schema (usually from @ai-preneur/shared) to validate `data` at runtime. */
  schema?: ZodType<T>;
}

type UnauthorizedListener = () => void;
let unauthorizedListener: UnauthorizedListener | undefined;

/** Registered by AuthProvider: any 401 means the session is gone → back to login. */
export function onUnauthorized(listener: UnauthorizedListener | undefined): void {
  unauthorizedListener = listener;
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
      // Send the HttpOnly session cookie. The token is never readable from JS.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError('Tidak dapat terhubung ke server.', 0, 'NETWORK_ERROR', error);
  }

  if (response.status === 401 && !path.startsWith('/auth/login')) unauthorizedListener?.();

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      `Respons server tidak valid (HTTP ${response.status}).`,
      response.status,
      'INVALID_RESPONSE',
    );
  }

  if (!isApiResponse(payload)) {
    throw new ApiClientError('Respons server tidak valid.', response.status, 'INVALID_RESPONSE');
  }

  if (!payload.success) {
    throw new ApiClientError(payload.error.message, response.status, payload.error.code, payload.error.details);
  }

  if (!schema) return payload.data as T;

  const parsed = schema.safeParse(payload.data);
  if (!parsed.success) {
    throw new ApiClientError(
      'Data dari server tidak sesuai kontrak.',
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

import type { ValidationIssue } from '@ai-preneur/shared';
import type { ZodError } from 'zod';

import { ApiClientError } from '../services/api-client';

export type FieldErrors = Partial<Record<string, string>>;

/** First message per top-level field from a client-side Zod validation. */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : 'form';
    result[key] ??= issue.message;
  }
  return result;
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

/** Field errors from a server VALIDATION_ERROR response. */
export function apiFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiClientError) || error.code !== 'VALIDATION_ERROR') return {};
  if (!Array.isArray(error.details)) return {};
  const result: FieldErrors = {};
  for (const issue of error.details) {
    if (!isValidationIssue(issue)) continue;
    const key = issue.path.split('.')[0] || 'form';
    result[key] ??= issue.message;
  }
  return result;
}

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'VALIDATION_ERROR') return 'Periksa kembali isian Anda.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Terjadi kesalahan yang tidak terduga.';
}

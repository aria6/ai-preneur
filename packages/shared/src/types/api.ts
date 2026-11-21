import type { ErrorCode } from '../constants/http.js';

/**
 * API response envelope.
 *
 * Every JSON response from the API is one of:
 *   { "success": true,  "data": T }
 *   { "success": false, "error": { "code", "message", "details"? } }
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  /** Optional structured context, e.g. `ValidationIssue[]` for VALIDATION_ERROR. */
  details?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** Shape of `details` items when `code` is VALIDATION_ERROR. */
export interface ValidationIssue {
  /** Dot-separated path to the invalid field, e.g. `address.city`. Empty for the root. */
  path: string;
  message: string;
  code: string;
}

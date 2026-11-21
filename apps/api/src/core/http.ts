import type { ApiSuccessResponse } from '@ai-preneur/shared';
import type { Response } from 'express';

/**
 * Sends a success envelope: `{ success: true, data }`.
 * Error envelopes are produced exclusively by the central error handler —
 * controllers throw `AppError` instead of writing error responses themselves.
 */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  const body: ApiSuccessResponse<T> = { success: true, data };
  res.status(statusCode).json(body);
}

/** For 204 responses (e.g. DELETE). No envelope, no body. */
export function sendNoContent(res: Response): void {
  res.status(204).end();
}

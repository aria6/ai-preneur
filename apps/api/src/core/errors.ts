import { ERROR_CODES, type ErrorCode } from '@ai-preneur/shared';

export interface AppErrorParams {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  cause?: unknown;
}

/**
 * The only error type that is allowed to reach clients with its message intact.
 * Anything else thrown in a request is reported as a generic 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor({ statusCode, code, message, details, cause }: AppErrorParams) {
    super(message, { cause });
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError({ statusCode: 400, code: ERROR_CODES.BAD_REQUEST, message, details });

export const notFound = (message = 'Resource not found'): AppError =>
  new AppError({ statusCode: 404, code: ERROR_CODES.NOT_FOUND, message });

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError({ statusCode: 409, code: ERROR_CODES.CONFLICT, message, details });

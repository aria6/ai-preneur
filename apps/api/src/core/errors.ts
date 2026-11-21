import { ERROR_CODES, type ErrorCode } from '@ai-preneur/shared';

export interface AppErrorParams {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  /** Extra response headers, e.g. Retry-After. */
  headers?: Readonly<Record<string, string>>;
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
  readonly headers: Readonly<Record<string, string>>;

  constructor({ statusCode, code, message, details, headers, cause }: AppErrorParams) {
    super(message, { cause });
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.headers = headers ?? {};
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError({ statusCode: 400, code: ERROR_CODES.BAD_REQUEST, message, details });

/** 400 VALIDATION_ERROR pointing at one field, rendered next to it by the frontend. */
export const fieldError = (path: string, message: string): AppError =>
  new AppError({
    statusCode: 400,
    code: ERROR_CODES.VALIDATION_ERROR,
    message,
    details: [{ path, message, code: 'custom' }],
  });

export const unauthorized = (message = 'Sesi tidak valid. Silakan masuk kembali.'): AppError =>
  new AppError({ statusCode: 401, code: ERROR_CODES.UNAUTHORIZED, message });

export const forbidden = (message = 'Anda tidak memiliki akses untuk tindakan ini.'): AppError =>
  new AppError({ statusCode: 403, code: ERROR_CODES.FORBIDDEN, message });

export const notFound = (message = 'Resource not found'): AppError =>
  new AppError({ statusCode: 404, code: ERROR_CODES.NOT_FOUND, message });

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError({ statusCode: 409, code: ERROR_CODES.CONFLICT, message, details });

export const tooManyRequests = (message: string, retryAfterSeconds: number): AppError =>
  new AppError({
    statusCode: 429,
    code: ERROR_CODES.TOO_MANY_REQUESTS,
    message,
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });

import { ERROR_CODES, type ApiErrorResponse } from '@ai-preneur/shared';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { AppError } from '../core/errors.js';
import type { Logger } from '../core/logger.js';
import { toValidationIssues } from '../core/validation.js';
import { REQUEST_ID_HEADER } from './request-logger.js';

/** Errors raised by express.json() carry `type` and `status`. */
function isBodyParserError(error: unknown): error is { type: string; status: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof error.type === 'string' &&
    'status' in error &&
    typeof error.status === 'number'
  );
}

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new AppError({
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Request validation failed',
      details: toValidationIssues(error),
    });
  }

  if (isBodyParserError(error)) {
    if (error.type === 'entity.too.large') {
      return new AppError({
        statusCode: 413,
        code: ERROR_CODES.PAYLOAD_TOO_LARGE,
        message: 'Request body is too large',
      });
    }
    return new AppError({
      statusCode: 400,
      code: ERROR_CODES.BAD_REQUEST,
      message: error.type === 'entity.parse.failed' ? 'Malformed JSON body' : 'Invalid request body',
    });
  }

  // Unknown error: never leak internals to the client.
  return new AppError({
    statusCode: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Internal server error',
    cause: error,
  });
}

/**
 * Central error handler — the single place that produces error envelopes.
 * Express 5 forwards rejected promises from async handlers here automatically.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      // Response already streaming: let Express close the connection.
      next(error);
      return;
    }

    const appError = normalizeError(error);
    const requestId = res.getHeader(REQUEST_ID_HEADER);

    if (appError.statusCode >= 500) {
      logger.error('Unhandled request error', {
        requestId,
        method: req.method,
        path: req.originalUrl,
        error: appError.cause ?? appError,
      });
    }

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details === undefined ? {} : { details: appError.details }),
      },
    };

    for (const [name, value] of Object.entries(appError.headers)) res.setHeader(name, value);
    res.status(appError.statusCode).json(body);
  };
}

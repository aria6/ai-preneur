import { ERROR_CODES } from '@ai-preneur/shared';
import type { RequestHandler } from 'express';

import { AppError } from '../core/errors.js';

/** Registered after all routes: anything that reaches it matched no route. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new AppError({
      statusCode: 404,
      code: ERROR_CODES.NOT_FOUND,
      message: `Route ${req.method} ${req.originalUrl} not found`,
    }),
  );
};

import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

import type { Logger } from '../core/logger.js';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const VALID_INCOMING_ID = /^[\w.-]{1,128}$/;

/**
 * Assigns a request id (reusing a sane incoming `X-Request-Id`), echoes it in the
 * response header and logs one line per completed request.
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(REQUEST_ID_HEADER);
    const requestId = incoming && VALID_INCOMING_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const meta = { requestId, durationMs: Math.round(durationMs * 10) / 10 };
      const message = `${req.method} ${req.originalUrl} ${res.statusCode}`;

      if (res.statusCode >= 500) logger.error(message, meta);
      else if (res.statusCode >= 400) logger.warn(message, meta);
      else logger.info(message, meta);
    });

    next();
  };
}

import { API_PREFIX } from '@ai-preneur/shared';
import cors from 'cors';
import express, { type Express } from 'express';

import type { AppDependencies } from './core/dependencies.js';
import { createErrorHandler } from './middlewares/error-handler.js';
import { notFoundHandler } from './middlewares/not-found.js';
import { createRequestLogger } from './middlewares/request-logger.js';
import { createApiRouter } from './routes/index.js';

/**
 * Builds the Express application. Pure: does not listen on a port, read env vars
 * or open connections — which keeps it usable from tests and other entry points.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(createRequestLogger(deps.logger));
  app.use(
    cors({
      origin: deps.config.cors.origins,
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(API_PREFIX, createApiRouter(deps));

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger));

  return app;
}

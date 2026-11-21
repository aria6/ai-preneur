import { API_PREFIX } from '@ai-preneur/shared';
import cors from 'cors';
import express, { type Express } from 'express';

import type { AppDependencies } from './core/dependencies.js';
import { createErrorHandler } from './middlewares/error-handler.js';
import { notFoundHandler } from './middlewares/not-found.js';
import { createOriginCheck } from './middlewares/origin-check.js';
import { createRequestLogger } from './middlewares/request-logger.js';
import { createSecurityHeaders } from './middlewares/security-headers.js';
import { createApiRouter } from './routes/index.js';

/**
 * Builds the Express application. Pure: does not listen on a port, read env vars
 * or open connections — which keeps it usable from tests and other entry points.
 */
export function createApp(deps: AppDependencies): Express {
  const { config } = deps;
  const app = express();

  app.disable('x-powered-by');
  // Needed for a correct req.ip / req.protocol behind a reverse proxy (rate limiting, origin check).
  app.set('trust proxy', config.server.trustProxy);

  app.use(createRequestLogger(deps.logger));
  app.use(createSecurityHeaders({ hsts: config.auth.cookieSecure }));
  app.use(
    cors({
      origin: config.cors.origins,
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
    }),
  );
  app.use(
    createOriginCheck({
      allowedOrigins: config.cors.origins,
      sessionCookieName: config.auth.cookieName,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.use(API_PREFIX, createApiRouter(deps));

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger));

  return app;
}

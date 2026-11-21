import express, { type Router } from 'express';

import type { AppDependencies } from '../core/dependencies.js';
import { createHealthRouter } from '../modules/health/index.js';

/**
 * Root API router, mounted at API_PREFIX (`/api`) in app.ts.
 * This is the single place where modules are wired into HTTP paths.
 */
export function createApiRouter(deps: AppDependencies): Router {
  const router = express.Router();

  router.use('/health', createHealthRouter({ database: deps.database }));

  // Register future modules here, passing only what each one needs, e.g.:
  // router.use('/users', createUsersRouter({ db: deps.database.db, logger: deps.logger }));

  return router;
}

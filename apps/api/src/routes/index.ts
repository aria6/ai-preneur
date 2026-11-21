import express, { type Router } from 'express';

import type { AppDependencies } from '../core/dependencies.js';
import { createHealthRouter } from '../modules/health/index.js';
import { createIamModule } from '../modules/iam/index.js';

/**
 * Root API router, mounted at API_PREFIX (`/api`) in app.ts.
 * This is the single place where modules are wired into HTTP paths.
 */
export function createApiRouter(deps: AppDependencies): Router {
  const router = express.Router();

  const iam = createIamModule({
    db: deps.database.db,
    logger: deps.logger,
    config: deps.config.auth,
  });

  router.use('/health', createHealthRouter({ database: deps.database }));

  // Resolves the session cookie for every route below. Access is enforced per
  // route with requireAuth / requirePermission.
  router.use(iam.authenticate);

  router.use('/auth', iam.routers.auth);
  router.use('/profile', iam.routers.profile);
  router.use('/users', iam.routers.users);
  router.use('/roles', iam.routers.roles);

  // Register future modules here, guarding them with requirePermission from the iam module.

  return router;
}

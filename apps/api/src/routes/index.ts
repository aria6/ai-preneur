import express, { type Router } from 'express';

import type { AppDependencies } from '../core/dependencies.js';
import { createRateLimiter } from '../middlewares/rate-limit.js';
import { createBankIdeaModuleRouter } from '../modules/bank-idea/index.js';
import { createHealthRouter } from '../modules/health/index.js';
import { createIamModule } from '../modules/iam/index.js';
import { createSocialMediaRouter } from '../modules/social-media/index.js';

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

  // Per-IP burst limit in front of the password-hashing endpoints, applied before
  // the hash runs. Complements the durable per-email/IP DB throttle.
  const authRateLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 15,
    message: 'Terlalu banyak percobaan. Silakan tunggu sebentar lalu coba lagi.',
  });
  router.use('/auth/login', authRateLimiter);
  router.use('/profile/password', authRateLimiter);

  // Resolves the session cookie for every route below. Access is enforced per
  // route with requireAuth / requirePermission.
  router.use(iam.authenticate);

  router.use('/auth', iam.routers.auth);
  router.use('/profile', iam.routers.profile);
  router.use('/users', iam.routers.users);
  router.use('/roles', iam.routers.roles);
  router.use(
    '/social',
    createSocialMediaRouter({
      db: deps.database.db,
      logger: deps.logger,
      config: deps.config.social,
      publisher: deps.socialPublisher,
    }),
  );

  router.use(
    '/bank-ideas',
    createBankIdeaModuleRouter({
      db: deps.database.db,
      logger: deps.logger,
      config: deps.config.bankIdea,
      worker: deps.bankIdeaWorker,
    }),
  );

  // Register future modules here, guarding them with requirePermission from the iam module.

  return router;
}

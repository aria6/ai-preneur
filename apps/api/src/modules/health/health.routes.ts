import express, { type Router } from 'express';

import { sendSuccess } from '../../core/http.js';
import { createHealthService, type HealthServiceDeps } from './health.service.js';

/**
 * GET /api/health
 *
 * 200 { success: true, data: { status: "ok", ... } }        — API and database reachable
 * 503 { success: true, data: { status: "degraded", ... } }  — API up, database unreachable
 *
 * The handler is small enough to live in the routes file; a separate
 * controller is introduced only once a module's handlers grow (see docs/architecture.md).
 */
export function createHealthRouter(deps: HealthServiceDeps): Router {
  const router = express.Router();
  const service = createHealthService(deps);

  router.get('/', async (_req, res) => {
    const health = await service.check();
    sendSuccess(res, health, health.status === 'ok' ? 200 : 503);
  });

  return router;
}

import {
  autoScheduleRequestSchema,
  connectInstagramRequestSchema,
  lookupInstagramAccountsRequestSchema,
  createBatchRequestSchema,
  createItemRequestSchema,
  PERMISSIONS,
  reorderItemsRequestSchema,
  resumeItemRequestSchema,
  publishNowRequestSchema,
  socialPlatformSchema,
  updateBatchRequestSchema,
  updateItemRequestSchema,
  updateSocialSettingsRequestSchema,
  uuidSchema,
  type BatchListResponse,
  type BatchResponse,
  type InstagramAccountsResponse,
  type InstagramMediaPageDto,
  type InstagramOverviewResponse,
  instagramMediaQuerySchema,
  instagramOverviewQuerySchema,
  type PerformanceIdeaListResponse,
  type PerformanceIdeaResponse,
  type ScanResponse,
} from '@ai-preneur/shared';
import express, { type Router } from 'express';
import { z } from 'zod';

import { sendNoContent, sendSuccess } from '../../../core/http.js';
import { parseInput } from '../../../core/validation.js';
import { requireAnyPermission, requireAuthContext, requirePermission } from '../../iam/index.js';
import type { AccountsService } from '../services/accounts.service.js';
import type { BatchesService } from '../services/batches.service.js';
import type { ItemsService } from '../services/items.service.js';
import type { PerformanceService } from '../services/performance.service.js';
import type { SettingsService } from '../services/settings.service.js';

const batchParams = z.object({ id: uuidSchema });
const itemParams = z.object({ id: uuidSchema, itemId: uuidSchema });
const accountParams = z.object({ id: uuidSchema, platform: socialPlatformSchema });

const canView = requirePermission(PERMISSIONS.SOCIAL_PUBLISHER_VIEW);
const canManage = requirePermission(PERMISSIONS.SOCIAL_PUBLISHER_MANAGE);
const canViewPerformance = requirePermission(PERMISSIONS.SOCIAL_PERFORMANCE_VIEW);

/**
 * Social Media AIgency — mounted at /api/social.
 *
 * GET    /settings                                   publisher.view | settings.manage
 * PUT    /settings                                   settings.manage
 * GET    /batches                                    publisher.view
 * POST   /batches                                    publisher.manage
 * GET    /batches/:id                                publisher.view
 * PATCH  /batches/:id                                publisher.manage
 * DELETE /batches/:id                                publisher.manage
 * POST   /batches/:id/scan                           publisher.manage  (Generate antrean konten)
 * POST   /batches/:id/auto-schedule                  publisher.manage  (Jadwalkan semua)
 * PUT    /batches/:id/order                          publisher.manage  (drag & drop)
 * POST   /batches/:id/confirm                        publisher.manage
 * POST   /batches/:id/cancel                         publisher.manage  (Batalkan jadwal)
 * POST   /batches/:id/items                          publisher.manage
 * PATCH  /batches/:id/items/:itemId                  publisher.manage
 * DELETE /batches/:id/items/:itemId                  publisher.manage
 * POST   /batches/:id/items/:itemId/pause            publisher.manage  (Tunda)
 * POST   /batches/:id/items/:itemId/resume           publisher.manage
 * POST   /batches/:id/items/:itemId/publish-now      publisher.manage  (Unggah sekarang)
 * POST   /batches/:id/accounts/instagram/lookup      publisher.manage  (Tes token: daftar akun)
 * PUT    /batches/:id/accounts/instagram             publisher.manage
 * DELETE /batches/:id/accounts/:platform             publisher.manage
 *
 * Performance AIgent (read live from the platform, nothing stored):
 * GET    /performance/ideas                          performance.view
 * GET    /performance/ideas/:id                      performance.view
 * GET    /performance/ideas/:id/instagram/overview   performance.view  (?days=7|14|30&refresh)
 * GET    /performance/ideas/:id/instagram/media      performance.view  (?after=cursor&refresh)
 */
export function createSocialRouter(deps: {
  batches: BatchesService;
  items: ItemsService;
  accounts: AccountsService;
  settings: SettingsService;
  performance: PerformanceService;
}): Router {
  const { batches, items, accounts, settings, performance } = deps;
  const router = express.Router();

  // ---- Settings ----
  router.get(
    '/settings',
    requireAnyPermission(PERMISSIONS.SOCIAL_PUBLISHER_VIEW, PERMISSIONS.SOCIAL_SETTINGS_MANAGE),
    async (_req, res) => {
      sendSuccess(res, { settings: await settings.get() });
    },
  );

  router.put(
    '/settings',
    requirePermission(PERMISSIONS.SOCIAL_SETTINGS_MANAGE),
    async (req, res) => {
      const input = parseInput(updateSocialSettingsRequestSchema, req.body);
      sendSuccess(res, { settings: await settings.update(requireAuthContext(req), input) });
    },
  );

  // ---- Batches ----
  router.get('/batches', canView, async (_req, res) => {
    sendSuccess<BatchListResponse>(res, { items: await batches.list() });
  });

  router.post('/batches', canManage, async (req, res) => {
    const input = parseInput(createBatchRequestSchema, req.body);
    sendSuccess<BatchResponse>(
      res,
      { batch: await batches.create(requireAuthContext(req), input) },
      201,
    );
  });

  router.get('/batches/:id', canView, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    sendSuccess<BatchResponse>(res, { batch: await batches.get(id) });
  });

  router.patch('/batches/:id', canManage, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    const input = parseInput(updateBatchRequestSchema, req.body);
    sendSuccess<BatchResponse>(res, {
      batch: await batches.update(requireAuthContext(req), id, input),
    });
  });

  router.delete('/batches/:id', canManage, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    await batches.delete(requireAuthContext(req), id);
    sendNoContent(res);
  });

  router.post('/batches/:id/scan', canManage, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    sendSuccess<ScanResponse>(res, await batches.scan(requireAuthContext(req), id));
  });

  router.post('/batches/:id/auto-schedule', canManage, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    const input = parseInput(autoScheduleRequestSchema, req.body);
    sendSuccess<BatchResponse>(res, {
      batch: await batches.autoSchedule(requireAuthContext(req), id, input),
    });
  });

  router.put('/batches/:id/order', canManage, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    const input = parseInput(reorderItemsRequestSchema, req.body);
    sendSuccess<BatchResponse>(res, {
      batch: await batches.reorder(requireAuthContext(req), id, input),
    });
  });

  router.post('/batches/:id/confirm', canManage, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    sendSuccess<BatchResponse>(res, { batch: await batches.confirm(requireAuthContext(req), id) });
  });

  router.post('/batches/:id/cancel', canManage, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    sendSuccess<BatchResponse>(res, {
      batch: await batches.cancelSchedule(requireAuthContext(req), id),
    });
  });

  // ---- Queue rows ----
  router.post('/batches/:id/items', canManage, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    const input = parseInput(createItemRequestSchema, req.body);
    sendSuccess<BatchResponse>(
      res,
      { batch: await items.create(requireAuthContext(req), id, input) },
      201,
    );
  });

  router.patch('/batches/:id/items/:itemId', canManage, async (req, res) => {
    const { id, itemId } = parseInput(itemParams, req.params);
    const input = parseInput(updateItemRequestSchema, req.body);
    sendSuccess<BatchResponse>(res, {
      batch: await items.update(requireAuthContext(req), id, itemId, input),
    });
  });

  router.delete('/batches/:id/items/:itemId', canManage, async (req, res) => {
    const { id, itemId } = parseInput(itemParams, req.params);
    sendSuccess<BatchResponse>(res, {
      batch: await items.delete(requireAuthContext(req), id, itemId),
    });
  });

  router.post('/batches/:id/items/:itemId/pause', canManage, async (req, res) => {
    const { id, itemId } = parseInput(itemParams, req.params);
    sendSuccess<BatchResponse>(res, {
      batch: await items.pause(requireAuthContext(req), id, itemId),
    });
  });

  router.post('/batches/:id/items/:itemId/resume', canManage, async (req, res) => {
    const { id, itemId } = parseInput(itemParams, req.params);
    const input = parseInput(resumeItemRequestSchema, req.body ?? {});
    sendSuccess<BatchResponse>(res, {
      batch: await items.resume(requireAuthContext(req), id, itemId, input),
    });
  });

  router.post('/batches/:id/items/:itemId/publish-now', canManage, async (req, res) => {
    const { id, itemId } = parseInput(itemParams, req.params);
    const input = parseInput(publishNowRequestSchema, req.body ?? {});
    sendSuccess<BatchResponse>(res, {
      batch: await items.publishNow(requireAuthContext(req), id, itemId, input),
    });
  });

  // ---- Accounts ----
  router.post('/batches/:id/accounts/instagram/lookup', canManage, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    const input = parseInput(lookupInstagramAccountsRequestSchema, req.body);
    sendSuccess<InstagramAccountsResponse>(res, {
      accounts: await accounts.lookupInstagramAccounts(requireAuthContext(req), id, input),
    });
  });

  router.put('/batches/:id/accounts/instagram', canManage, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    const input = parseInput(connectInstagramRequestSchema, req.body);
    sendSuccess<BatchResponse>(res, {
      batch: await accounts.connectInstagram(requireAuthContext(req), id, input),
    });
  });

  router.delete('/batches/:id/accounts/:platform', canManage, async (req, res) => {
    const { id, platform } = parseInput(accountParams, req.params);
    sendSuccess<BatchResponse>(res, {
      batch: await accounts.disconnect(requireAuthContext(req), id, platform),
    });
  });

  // ---- Performance AIgent ----
  router.get('/performance/ideas', canViewPerformance, async (_req, res) => {
    sendSuccess<PerformanceIdeaListResponse>(res, { items: await performance.listIdeas() });
  });

  router.get('/performance/ideas/:id', canViewPerformance, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    sendSuccess<PerformanceIdeaResponse>(res, { idea: await performance.getIdea(id) });
  });

  router.get('/performance/ideas/:id/instagram/overview', canViewPerformance, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    const query = parseInput(instagramOverviewQuerySchema, req.query);
    sendSuccess<InstagramOverviewResponse>(res, {
      overview: await performance.instagramOverview(id, query.days, query.refresh),
    });
  });

  router.get('/performance/ideas/:id/instagram/media', canViewPerformance, async (req, res) => {
    const { id } = parseInput(batchParams, req.params);
    const query = parseInput(instagramMediaQuerySchema, req.query);
    sendSuccess<InstagramMediaPageDto>(
      res,
      await performance.instagramMedia(id, query.after, query.refresh),
    );
  });

  return router;
}

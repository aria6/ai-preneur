import {
  bankIdeaListQuerySchema,
  createBankIdeaRequestSchema,
  PERMISSIONS,
  startBankIdeaResearchRequestSchema,
  structureBankIdeaRequestSchema,
  updateBankIdeaRequestSchema,
  uuidSchema,
  type BankIdeaDetailResponse,
  type BankIdeaListResponse,
  type BankIdeaResearchStatusResponse,
  type BankIdeaResponse,
  type StructureBankIdeaResponse,
} from '@ai-preneur/shared';
import express, { type Router } from 'express';
import { z } from 'zod';

import { forbidden } from '../../core/errors.js';
import { sendNoContent, sendSuccess } from '../../core/http.js';
import { parseInput } from '../../core/validation.js';
import { requireAuthContext, requirePermission } from '../iam/index.js';
import type { BankIdeaService } from './bank-idea.service.js';

const ideaParams = z.object({ id: uuidSchema });
const runParams = z.object({ id: uuidSchema, runId: uuidSchema });

const canView = requirePermission(PERMISSIONS.BANK_IDEA_VIEW);
const canManage = requirePermission(PERMISSIONS.BANK_IDEA_MANAGE);
const canResearch = requirePermission(PERMISSIONS.BANK_IDEA_RESEARCH);

/**
 * Bank Idea — mounted at /api/bank-ideas.
 *
 * GET    /?filter=active|archived            view
 * POST   /structure                          research   (Rapikan dengan AI → draft, not saved)
 * POST   /                                   manage     (+ research: "Simpan & Riset" also needs research)
 * GET    /:id                                view       (idea + all research versions)
 * PATCH  /:id                                manage     (content, cakupan pasar, Tandai dieksekusi)
 * POST   /:id/archive · /unarchive           manage
 * DELETE /:id                                manage     (hapus permanen)
 * POST   /:id/research                       research   (queue a research / riset ulang; { focusSegment? })
 * GET    /:id/research/status                view       (polled while queued/running)
 * POST   /:id/synthesis                      research   (Kesimpulan gabungan, background; page polls GET /:id)
 * POST   /:id/research/:runId/cancel         research
 */
export function createBankIdeaRouter(deps: { service: BankIdeaService }): Router {
  const { service } = deps;
  const router = express.Router();

  router.get('/', canView, async (req, res) => {
    const { filter } = parseInput(bankIdeaListQuerySchema, req.query);
    sendSuccess<BankIdeaListResponse>(res, { items: await service.list(filter) });
  });

  router.post('/structure', canResearch, async (req, res) => {
    const { rawInput } = parseInput(structureBankIdeaRequestSchema, req.body);
    sendSuccess<StructureBankIdeaResponse>(res, { draft: await service.structure(rawInput) });
  });

  router.post('/', canManage, async (req, res) => {
    const input = parseInput(createBankIdeaRequestSchema, req.body);
    const auth = requireAuthContext(req);
    // "Simpan & Riset" spends AI quota, so it needs the research permission as well.
    if (input.research && !auth.permissions.has(PERMISSIONS.BANK_IDEA_RESEARCH)) {
      throw forbidden('Anda tidak memiliki akses untuk menjalankan riset AI.');
    }
    sendSuccess<BankIdeaResponse>(res, { idea: await service.create(auth, input) }, 201);
  });

  router.get('/:id', canView, async (req, res) => {
    const { id } = parseInput(ideaParams, req.params);
    sendSuccess<BankIdeaDetailResponse>(res, await service.detail(id));
  });

  router.patch('/:id', canManage, async (req, res) => {
    const { id } = parseInput(ideaParams, req.params);
    const input = parseInput(updateBankIdeaRequestSchema, req.body);
    sendSuccess<BankIdeaResponse>(res, {
      idea: await service.update(requireAuthContext(req), id, input),
    });
  });

  router.post('/:id/archive', canManage, async (req, res) => {
    const { id } = parseInput(ideaParams, req.params);
    sendSuccess<BankIdeaResponse>(res, {
      idea: await service.setArchived(requireAuthContext(req), id, true),
    });
  });

  router.post('/:id/unarchive', canManage, async (req, res) => {
    const { id } = parseInput(ideaParams, req.params);
    sendSuccess<BankIdeaResponse>(res, {
      idea: await service.setArchived(requireAuthContext(req), id, false),
    });
  });

  router.delete('/:id', canManage, async (req, res) => {
    const { id } = parseInput(ideaParams, req.params);
    await service.delete(requireAuthContext(req), id);
    sendNoContent(res);
  });

  router.post('/:id/research', canResearch, async (req, res) => {
    const { id } = parseInput(ideaParams, req.params);
    const { focusSegment } = parseInput(startBankIdeaResearchRequestSchema, req.body ?? {});
    sendSuccess<BankIdeaResearchStatusResponse>(
      res,
      await service.startResearch(requireAuthContext(req), id, focusSegment ?? null),
      202,
    );
  });

  router.post('/:id/synthesis', canResearch, async (req, res) => {
    const { id } = parseInput(ideaParams, req.params);
    sendSuccess<BankIdeaDetailResponse>(
      res,
      await service.startSynthesis(requireAuthContext(req), id),
      202,
    );
  });

  router.get('/:id/research/status', canView, async (req, res) => {
    const { id } = parseInput(ideaParams, req.params);
    sendSuccess<BankIdeaResearchStatusResponse>(res, await service.researchStatus(id));
  });

  router.post('/:id/research/:runId/cancel', canResearch, async (req, res) => {
    const { id, runId } = parseInput(runParams, req.params);
    sendSuccess<BankIdeaResearchStatusResponse>(
      res,
      await service.cancelResearch(requireAuthContext(req), id, runId),
    );
  });

  return router;
}

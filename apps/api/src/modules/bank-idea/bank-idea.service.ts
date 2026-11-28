import { isUniqueViolation, type Database, type DatabaseExecutor } from '@ai-preneur/database';
import {
  BANK_IDEA_RUBRIC_VERSION,
  ERROR_CODES,
  type BankIdeaDetailResponse,
  type BankIdeaDraft,
  type BankIdeaDto,
  type BankIdeaListFilter,
  type BankIdeaResearchStatusResponse,
  type BankIdeaSummaryDto,
  type createBankIdeaRequestSchema,
  type updateBankIdeaRequestSchema,
} from '@ai-preneur/shared';
import type { z } from 'zod';

import { AppError, conflict, notFound } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import type { AuthContext } from '../iam/index.js';
import type { BankIdeaAi } from './ai/bank-idea-ai.js';
import { AiError } from './ai/llm-runner.js';
import { toActiveRunDto, toIdeaDto, toIdeaSummary, toRunDto } from './bank-idea.mappers.js';
import { createBankIdeaRepository, type ActiveRun } from './bank-idea.repository.js';
import type { ResearchWorker } from './research.worker.js';

type CreateInput = z.output<typeof createBankIdeaRequestSchema>;
type UpdateInput = z.output<typeof updateBankIdeaRequestSchema>;

/** Fields whose change makes the latest research outdated. */
const CONTENT_FIELDS = ['title', 'summary', 'problem', 'solution', 'marketScope'] as const;

const aiUnavailable = (message: string) =>
  new AppError({ statusCode: 503, code: ERROR_CODES.SERVICE_UNAVAILABLE, message });

/** Queues a research for an idea inside the caller's transaction. */
async function queueResearch(
  tx: DatabaseExecutor,
  ideaId: string,
  marketScope: 'indonesia' | 'global',
  auth: AuthContext,
  focusSegment: string | null = null,
): Promise<void> {
  const txRepo = createBankIdeaRepository(tx);
  try {
    await txRepo.insertRun({
      ideaId,
      version: await txRepo.nextVersion(ideaId),
      marketScope,
      rubricVersion: BANK_IDEA_RUBRIC_VERSION,
      focusSegment,
      requestedById: auth.user.id,
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict('Ide ini sedang diriset atau sudah ada di antrean.');
    throw error;
  }
}

export function createBankIdeaService(deps: {
  db: Database;
  logger: Logger;
  ai: BankIdeaAi;
  /** Null when BANK_IDEA_WORKER_ENABLED=false: researches stay queued. */
  worker: Pick<ResearchWorker, 'wake' | 'cancel'> | null;
}) {
  const { db, logger, ai, worker } = deps;
  const repo = createBankIdeaRepository(db);
  /** "Rapikan dengan AI" runs one at a time too (same AI quota). */
  let structuring = false;

  async function activeByIdea(): Promise<Map<string, ActiveRun>> {
    const runs = await repo.activeRuns();
    return new Map(runs.map((run) => [run.ideaId, run]));
  }

  async function requireIdea(id: string) {
    const idea = await repo.findIdea(id);
    if (!idea) throw notFound('Ide tidak ditemukan.');
    return idea;
  }

  async function dto(id: string): Promise<BankIdeaDto> {
    const [idea, active] = await Promise.all([requireIdea(id), activeByIdea()]);
    return toIdeaDto(idea, active.get(id));
  }

  async function researchStatus(id: string): Promise<BankIdeaResearchStatusResponse> {
    await requireIdea(id);
    const [active, lastFinishedRunId] = await Promise.all([
      activeByIdea(),
      repo.lastFinishedRunId(id),
    ]);
    return { activeRun: toActiveRunDto(active.get(id)), lastFinishedRunId };
  }

  return {
    researchStatus,

    async list(filter: BankIdeaListFilter): Promise<BankIdeaSummaryDto[]> {
      const [ideas, active] = await Promise.all([repo.listIdeas(filter), activeByIdea()]);
      return ideas.map((idea) => toIdeaSummary(idea, active.get(idea.id)));
    },

    async detail(id: string): Promise<BankIdeaDetailResponse> {
      const [idea, runs] = await Promise.all([dto(id), repo.listRuns(id)]);
      return { idea, runs: runs.map(toRunDto) };
    },

    async structure(rawInput: string): Promise<BankIdeaDraft> {
      if (structuring) throw conflict('AI sedang merapikan ide lain. Coba lagi sebentar.');
      structuring = true;
      try {
        return await ai.structure(rawInput);
      } catch (error) {
        if (error instanceof AiError) throw aiUnavailable(error.message);
        throw error;
      } finally {
        structuring = false;
      }
    },

    async create(auth: AuthContext, input: CreateInput): Promise<BankIdeaDto> {
      const { research, ...values } = input;
      const id = await db.transaction(async (tx) => {
        const idea = await createBankIdeaRepository(tx).insertIdea({
          ...values,
          createdById: auth.user.id,
        });
        if (research) await queueResearch(tx, idea.id, idea.marketScope, auth);
        return idea.id;
      });
      if (research) worker?.wake();
      logger.info('Bank Idea created', { ideaId: id, research, userId: auth.user.id });
      return dto(id);
    },

    async update(auth: AuthContext, id: string, input: UpdateInput): Promise<BankIdeaDto> {
      await db.transaction(async (tx) => {
        const txRepo = createBankIdeaRepository(tx);
        const idea = await txRepo.findIdeaForUpdate(id);
        if (!idea) throw notFound('Ide tidak ditemukan.');
        if (idea.archivedAt) throw conflict('Ide yang diarsip tidak bisa diubah. Pulihkan dulu.');

        const { executed, ...content } = input;
        const contentChanged = CONTENT_FIELDS.some(
          (field) => content[field] !== undefined && content[field] !== idea[field],
        );
        let stage = idea.stage;
        if (executed === true) stage = 'executed';
        if (executed === false && idea.stage === 'executed') {
          stage = idea.lastResearchedAt ? 'researched' : 'new';
        }

        await txRepo.updateIdea(id, {
          ...Object.fromEntries(Object.entries(content).filter(([, v]) => v !== undefined)),
          stage,
          ...(contentChanged ? { contentUpdatedAt: new Date() } : {}),
        });
      });
      logger.info('Bank Idea updated', { ideaId: id, userId: auth.user.id });
      return dto(id);
    },

    async setArchived(auth: AuthContext, id: string, archived: boolean): Promise<BankIdeaDto> {
      const idea = await requireIdea(id);
      if (archived && (await activeByIdea()).has(id)) {
        throw conflict(
          'Ide ini sedang diriset atau ada di antrean. Tunggu selesai atau batalkan dulu.',
        );
      }
      if (Boolean(idea.archivedAt) !== archived) {
        await repo.updateIdea(id, { archivedAt: archived ? new Date() : null });
        logger.info(archived ? 'Bank Idea archived' : 'Bank Idea unarchived', {
          ideaId: id,
          userId: auth.user.id,
        });
      }
      return dto(id);
    },

    async delete(auth: AuthContext, id: string): Promise<void> {
      await requireIdea(id);
      if ((await activeByIdea()).has(id)) {
        throw conflict(
          'Ide ini sedang diriset atau ada di antrean. Tunggu selesai atau batalkan dulu.',
        );
      }
      await repo.deleteIdea(id);
      logger.info('Bank Idea deleted permanently', { ideaId: id, userId: auth.user.id });
    },

    async startResearch(
      auth: AuthContext,
      id: string,
      focusSegment: string | null = null,
    ): Promise<BankIdeaResearchStatusResponse> {
      await db.transaction(async (tx) => {
        const idea = await createBankIdeaRepository(tx).findIdeaForUpdate(id);
        if (!idea) throw notFound('Ide tidak ditemukan.');
        if (idea.archivedAt) throw conflict('Ide yang diarsip tidak bisa diriset. Pulihkan dulu.');
        await queueResearch(tx, id, idea.marketScope, auth, focusSegment);
      });
      worker?.wake();
      logger.info('Bank Idea research queued', {
        ideaId: id,
        focused: focusSegment !== null,
        userId: auth.user.id,
      });
      return researchStatus(id);
    },

    async cancelResearch(
      auth: AuthContext,
      id: string,
      runId: string,
    ): Promise<BankIdeaResearchStatusResponse> {
      const run = await repo.findRun(runId);
      if (!run || run.ideaId !== id) throw notFound('Riset tidak ditemukan.');
      if (run.status === 'queued') {
        await repo.cancelQueued(runId);
      } else if (run.status === 'running') {
        if (!worker?.cancel(runId)) {
          throw conflict('Riset sedang berjalan dan belum bisa dihentikan. Coba lagi sebentar.');
        }
      } else {
        throw conflict('Riset ini sudah selesai.');
      }
      logger.info('Bank Idea research cancel requested', { runId, userId: auth.user.id });
      return researchStatus(id);
    },
  };
}

export type BankIdeaService = ReturnType<typeof createBankIdeaService>;

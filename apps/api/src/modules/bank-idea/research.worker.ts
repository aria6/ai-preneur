import {
  isUniqueViolation,
  type BankIdeaResearchRunRow,
  type Database,
} from '@ai-preneur/database';

import type { Logger } from '../../core/logger.js';
import type { BankIdeaAi } from './ai/bank-idea-ai.js';
import { AiError } from './ai/llm-runner.js';
import { createBankIdeaRepository } from './bank-idea.repository.js';

const HEARTBEAT_MS = 30_000;
/** A running row without heartbeat this long belongs to a server that stopped. */
const STALE_AFTER_MS = 3 * 60_000;
/** Claims before an interrupted run is given up. */
const MAX_ATTEMPTS = 2;

export interface ResearchWorker {
  start(): void;
  /** Checks the queue now (after a research is queued) instead of waiting for the interval. */
  wake(): void;
  /** Stops the running research if it is this one. True when it was running here. */
  cancel(runId: string): boolean;
  /** Stops polling; the running research is put back in the queue. */
  stop(): Promise<void>;
}

/**
 * Runs queued Bank Idea researches one at a time, inside the API process, by polling
 * PostgreSQL (no Redis/queue). The AI quota is shared, so only one research runs
 * platform-wide; the rest wait in order.
 */
export function createResearchWorker(deps: {
  db: Database;
  logger: Logger;
  ai: BankIdeaAi;
  intervalMs: number;
}): ResearchWorker {
  const { db, logger, ai, intervalMs } = deps;
  const repo = createBankIdeaRepository(db);

  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | null = null;
  let stopped = true;
  let wakeRequested = false;
  let current: {
    runId: string;
    controller: AbortController;
    reason: 'cancel' | 'shutdown' | null;
  } | null = null;

  async function execute(run: BankIdeaResearchRunRow): Promise<void> {
    const idea = await repo.findIdea(run.ideaId);
    if (!idea) {
      await repo.markFinished(run.id, 'failed', {
        errorMessage: 'Ide sudah dihapus.',
        durationMs: null,
      });
      return;
    }

    const controller = new AbortController();
    current = { runId: run.id, controller, reason: null };
    const heartbeat = setInterval(() => {
      void repo
        .heartbeat(run.id)
        .catch((error: unknown) =>
          logger.warn('Bank Idea heartbeat failed', { runId: run.id, error }),
        );
    }, HEARTBEAT_MS);
    const started = Date.now();
    logger.info('Bank Idea research started', {
      runId: run.id,
      ideaId: idea.id,
      version: run.version,
    });

    try {
      const { result, meta } = await ai.research(
        {
          title: idea.title,
          summary: idea.summary,
          problem: idea.problem,
          solution: idea.solution,
          marketScope: run.marketScope,
        },
        controller.signal,
      );
      const durationMs = Date.now() - started;

      await db.transaction(async (tx) => {
        const txRepo = createBankIdeaRepository(tx);
        const saved = await txRepo.markSucceeded(run.id, { result, meta, durationMs });
        if (!saved) return; // idea deleted meanwhile
        await txRepo.recordResearch(run.ideaId, {
          score: result.totalScore,
          label: result.label,
          at: saved.finishedAt ?? new Date(),
        });
      });
      logger.info('Bank Idea research succeeded', {
        runId: run.id,
        totalScore: result.totalScore,
        durationMs,
        ...meta,
      });
    } catch (error) {
      const durationMs = Date.now() - started;
      if (error instanceof AiError && error.aborted) {
        if (current?.reason === 'cancel') {
          await repo.markFinished(run.id, 'cancelled', { errorMessage: null, durationMs });
          logger.info('Bank Idea research cancelled', { runId: run.id });
        } else {
          await repo.requeue(run.id);
          logger.info('Bank Idea research interrupted, re-queued', { runId: run.id });
        }
        return;
      }
      const message =
        error instanceof AiError ? error.message : 'Terjadi kesalahan tak terduga saat riset.';
      if (!(error instanceof AiError))
        logger.error('Bank Idea research crashed', { runId: run.id, error });
      else logger.warn('Bank Idea research failed', { runId: run.id, message });
      await repo.markFinished(run.id, 'failed', { errorMessage: message, durationMs });
    } finally {
      clearInterval(heartbeat);
      current = null;
    }
  }

  async function tick(): Promise<void> {
    await repo.recoverStale(new Date(Date.now() - STALE_AFTER_MS), MAX_ATTEMPTS);
    for (;;) {
      if (stopped) return;
      let run: BankIdeaResearchRunRow | null;
      try {
        run = await repo.claimNext();
      } catch (error) {
        if (isUniqueViolation(error)) return; // another claim won the single running slot
        throw error;
      }
      if (!run) return;
      await execute(run);
    }
  }

  function runTick(): void {
    wakeRequested = false;
    inFlight = tick()
      .catch((error: unknown) => logger.error('Bank Idea worker tick failed', { error }))
      .finally(() => {
        inFlight = null;
        if (wakeRequested && !stopped) runTick();
        else scheduleNext();
      });
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(runTick, intervalMs);
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      logger.info('Bank Idea research worker started', { intervalMs });
      runTick();
    },
    wake() {
      if (stopped) return;
      if (inFlight) {
        wakeRequested = true;
        return;
      }
      if (timer) clearTimeout(timer);
      runTick();
    },
    cancel(runId) {
      if (current?.runId !== runId) return false;
      current.reason = 'cancel';
      current.controller.abort();
      return true;
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (current) {
        current.reason = 'shutdown';
        current.controller.abort();
      }
      if (inFlight) await inFlight;
    },
  };
}

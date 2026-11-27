/**
 * Public API of the Bank Idea module: stores ideas, tidies raw text into a structured
 * idea with AI, and researches each idea on the web (trend, market size, competition,
 * monetization) into a 0–100 score with reasons and sources. See docs/bank-idea.md.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Database } from '@ai-preneur/database';
import type { Router } from 'express';

import type { Logger } from '../../core/logger.js';
import { createBankIdeaAi, type BankIdeaAi } from './ai/bank-idea-ai.js';
import { createClaudeCliRunner } from './ai/claude-cli.runner.js';
import { createBankIdeaRouter } from './bank-idea.routes.js';
import { createBankIdeaService } from './bank-idea.service.js';
import { createResearchWorker, type ResearchWorker } from './research.worker.js';

/** Settings the module needs, supplied by the composition root from AppConfig.bankIdea. */
export interface BankIdeaModuleConfig {
  workerIntervalMs: number;
  provider: 'claude-cli';
  claudeBin: string;
  claudeModel: string | null;
  researchTimeoutMs: number;
}

interface BankIdeaDeps {
  db: Database;
  logger: Logger;
  config: BankIdeaModuleConfig;
}

function createAi(deps: BankIdeaDeps): BankIdeaAi {
  const runner = createClaudeCliRunner({
    bin: deps.config.claudeBin,
    model: deps.config.claudeModel,
    // Empty folder: the CLI has nothing of the app to read or change.
    workDir: join(tmpdir(), 'ai-preneur-bank-idea'),
    logger: deps.logger,
  });
  return createBankIdeaAi({
    runner,
    logger: deps.logger,
    researchTimeoutMs: deps.config.researchTimeoutMs,
  });
}

export function createBankIdeaModuleRouter(
  deps: BankIdeaDeps & {
    /** The running research worker, or null when BANK_IDEA_WORKER_ENABLED=false. */
    worker: Pick<ResearchWorker, 'wake' | 'cancel'> | null;
  },
): Router {
  return createBankIdeaRouter({
    service: createBankIdeaService({
      db: deps.db,
      logger: deps.logger,
      ai: createAi(deps),
      worker: deps.worker,
    }),
  });
}

/** Background research runner. Started by server.ts when BANK_IDEA_WORKER_ENABLED=true. */
export function createBankIdeaWorker(deps: BankIdeaDeps): ResearchWorker {
  return createResearchWorker({
    db: deps.db,
    logger: deps.logger,
    ai: createAi(deps),
    intervalMs: deps.config.workerIntervalMs,
  });
}

export type { ResearchWorker as BankIdeaWorker } from './research.worker.js';

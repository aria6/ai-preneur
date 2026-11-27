import type { BankIdeaResearchRunRow, BankIdeaRow } from '@ai-preneur/database';
import {
  bankIdeaResearchResultSchema,
  type BankIdeaActiveRunDto,
  type BankIdeaDto,
  type BankIdeaRunDto,
  type BankIdeaSummaryDto,
} from '@ai-preneur/shared';

import type { ActiveRun } from './bank-idea.repository.js';

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export function toActiveRunDto(run: ActiveRun | undefined): BankIdeaActiveRunDto | null {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    queuePosition: run.queuePosition,
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
  };
}

export function toIdeaSummary(
  idea: BankIdeaRow,
  activeRun: ActiveRun | undefined,
): BankIdeaSummaryDto {
  return {
    id: idea.id,
    title: idea.title,
    summary: idea.summary,
    agency: idea.agency,
    marketScope: idea.marketScope,
    stage: idea.stage,
    latestScore: idea.latestScore,
    latestLabel: idea.latestLabel,
    lastResearchedAt: iso(idea.lastResearchedAt),
    changedSinceResearch:
      idea.lastResearchedAt !== null && idea.contentUpdatedAt > idea.lastResearchedAt,
    activeRun: toActiveRunDto(activeRun),
    archivedAt: iso(idea.archivedAt),
    createdAt: idea.createdAt.toISOString(),
  };
}

export function toIdeaDto(idea: BankIdeaRow, activeRun: ActiveRun | undefined): BankIdeaDto {
  return {
    ...toIdeaSummary(idea, activeRun),
    rawInput: idea.rawInput,
    problem: idea.problem,
    targetMarket: idea.targetMarket,
    solution: idea.solution,
    updatedAt: idea.updatedAt.toISOString(),
  };
}

export function toRunDto(run: BankIdeaResearchRunRow): BankIdeaRunDto {
  // Stored results are re-validated so an old/odd row can never break the page.
  const result = run.result ? bankIdeaResearchResultSchema.safeParse(run.result) : null;
  return {
    id: run.id,
    version: run.version,
    status: run.status,
    marketScope: run.marketScope,
    totalScore: run.totalScore,
    label: run.label,
    result: result?.success ? result.data : null,
    errorMessage: run.errorMessage,
    durationMs: run.durationMs,
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
  };
}

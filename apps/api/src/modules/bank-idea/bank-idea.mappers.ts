import type { BankIdeaResearchRunRow, BankIdeaRow } from '@ai-preneur/database';
import {
  BANK_IDEA_SYNTHESIS_STATUSES,
  bankIdeaResearchResultSchema,
  bankIdeaSynthesisResultSchema,
  type BankIdeaSynthesisDto,
  type BankIdeaSynthesisStatus,
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
    focusSegment: run.focusSegment,
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

/** A "running" conclusion whose process died (restart) is reported as failed. */
const SYNTHESIS_STALE_MS = 6 * 60_000;

export function latestSucceededId(runs: BankIdeaRunDto[]): string | null {
  return (
    runs
      .filter((run) => run.status === 'succeeded' && run.result)
      .toSorted((a, b) => b.version - a.version)[0]?.id ?? null
  );
}

export function toSynthesisDto(
  idea: BankIdeaRow,
  latestRunId: string | null,
): BankIdeaSynthesisDto {
  const result = idea.synthesis ? bankIdeaSynthesisResultSchema.safeParse(idea.synthesis) : null;
  const stale =
    idea.synthesisStatus === 'running' &&
    (!idea.synthesisStartedAt ||
      Date.now() - idea.synthesisStartedAt.getTime() > SYNTHESIS_STALE_MS);
  const status = stale
    ? 'failed'
    : BANK_IDEA_SYNTHESIS_STATUSES.includes(idea.synthesisStatus as BankIdeaSynthesisStatus)
      ? (idea.synthesisStatus as BankIdeaSynthesisStatus)
      : 'none';
  return {
    status,
    result: result?.success ? result.data : null,
    createdAt: iso(idea.synthesisAt),
    outdated: Boolean(result?.success && latestRunId && latestRunId !== idea.synthesisRunId),
    errorMessage: stale
      ? 'Penyusunan terhenti (server sempat berhenti). Coba lagi.'
      : idea.synthesisError,
  };
}

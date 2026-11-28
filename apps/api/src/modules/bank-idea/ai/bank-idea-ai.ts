import type {
  BankIdeaDraft,
  BankIdeaResearchResult,
  BankIdeaSynthesisResult,
} from '@ai-preneur/shared';

import type { Logger } from '../../../core/logger.js';
import { computeResearchResult } from '../domain/scoring.js';
import { AiError, type LlmRunner } from './llm-runner.js';
import {
  OutputError,
  parseDraft,
  parseResearch,
  parseSynthesis,
  type ParsedResearch,
} from './output.js';
import {
  repairPrompt,
  researchPrompt,
  structurePrompt,
  synthesisPrompt,
  type ResearchPromptInput,
  type SynthesisPromptInput,
} from './prompts.js';

const STRUCTURE_TIMEOUT_MS = 2 * 60_000;
const SYNTHESIS_TIMEOUT_MS = 4 * 60_000;
const REPAIR_TIMEOUT_MS = 3 * 60_000;
const RESEARCH_MAX_TURNS = 40;
const REPAIR_INPUT_MAX = 40_000;

export interface BankIdeaAi {
  /** Combined conclusion over every version. No web access. */
  synthesize(
    input: SynthesisPromptInput,
    segments: readonly string[],
  ): Promise<Omit<BankIdeaSynthesisResult, 'versions'>>;
  /** Raw text → structured draft. No web access; quick. */
  structure(rawInput: string): Promise<BankIdeaDraft>;
  /** Web research + scoring. Long (minutes); abort with the signal. */
  research(
    idea: ResearchPromptInput,
    signal: AbortSignal,
  ): Promise<{ result: BankIdeaResearchResult; meta: Record<string, unknown> }>;
}

function todayInJakarta(): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());
}

export function createBankIdeaAi(deps: {
  runner: LlmRunner;
  logger: Logger;
  researchTimeoutMs: number;
}): BankIdeaAi {
  const { runner, logger, researchTimeoutMs } = deps;

  return {
    async synthesize(input, segments) {
      const { text } = await runner.run(synthesisPrompt(input), {
        tools: 'none',
        timeoutMs: SYNTHESIS_TIMEOUT_MS,
        maxTurns: 3,
      });
      try {
        return parseSynthesis(text, segments);
      } catch (error) {
        if (error instanceof OutputError) {
          throw new AiError(`Kesimpulan gabungan dari AI tidak bisa dibaca (${error.message}).`);
        }
        throw error;
      }
    },

    async structure(rawInput) {
      const { text } = await runner.run(structurePrompt(rawInput), {
        tools: 'none',
        timeoutMs: STRUCTURE_TIMEOUT_MS,
        maxTurns: 3,
      });
      try {
        return parseDraft(text);
      } catch (error) {
        if (error instanceof OutputError) {
          throw new AiError(
            `AI tidak mengembalikan ide terstruktur (${error.message}). Coba lagi.`,
          );
        }
        throw error;
      }
    },

    async research(idea, signal) {
      const started = Date.now();
      const first = await runner.run(researchPrompt(idea, todayInJakarta()), {
        tools: 'web',
        timeoutMs: researchTimeoutMs,
        maxTurns: RESEARCH_MAX_TURNS,
        signal,
      });

      let parsed: ParsedResearch;
      let repaired = false;
      try {
        parsed = parseResearch(first.text, idea.focusSegment, idea.existingSegments);
      } catch (error) {
        if (!(error instanceof OutputError)) throw error;
        // One cheap repair pass (no tools) instead of redoing the whole research.
        logger.warn('Bank Idea research output invalid, asking for a repair', {
          problem: error.message,
        });
        const remaining = Math.max(60_000, researchTimeoutMs - (Date.now() - started));
        const fixed = await runner.run(
          repairPrompt(first.text.slice(0, REPAIR_INPUT_MAX), error.message),
          { tools: 'none', timeoutMs: Math.min(REPAIR_TIMEOUT_MS, remaining), maxTurns: 3, signal },
        );
        try {
          parsed = parseResearch(fixed.text, idea.focusSegment, idea.existingSegments);
          repaired = true;
        } catch (again) {
          if (again instanceof OutputError) {
            throw new AiError(`Hasil riset dari AI tidak bisa dibaca (${again.message}).`);
          }
          throw again;
        }
      }

      return {
        result: computeResearchResult(parsed),
        meta: { ...first.meta, repaired },
      };
    },
  };
}

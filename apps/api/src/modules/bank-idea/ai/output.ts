import {
  BANK_IDEA_AGENCIES,
  BANK_IDEA_CRITERIA,
  BANK_IDEA_TEXT_MAX_LENGTH,
  BANK_IDEA_TITLE_MAX_LENGTH,
  type BankIdeaAgency,
  type BankIdeaCompetitor,
  type BankIdeaConfidence,
  type BankIdeaCriterion,
  type BankIdeaCriterionResult,
  type BankIdeaDraft,
  type BankIdeaResearchResult,
  type BankIdeaSource,
} from '@ai-preneur/shared';
import { z } from 'zod';

/**
 * Turning the AI's text into trusted data: extract the JSON, validate it leniently,
 * then normalize (clamp scores, keep only http(s) links, cut long text). Anything
 * that cannot be trusted fails with OutputError so the caller can ask for a repair.
 */
export class OutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputError';
  }
}

const MAX_REASON = 1_500;
const MAX_SOURCES = 6;
const MAX_COMPETITORS = 8;
const MAX_LIST_ITEMS = 5;
const MAX_ITEM = 500;

/** The first JSON object in the text: a ```json fence, else first `{` to last `}`. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new OutputError('tidak ada objek JSON');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new OutputError(`JSON tidak valid (${(error as Error).message})`);
  }
}

const cut = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+\n/g, '\n').trim().slice(0, max) : '';

/** Only absolute http(s) URLs are kept — they are rendered as links in the browser. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString().slice(0, 1_000);
  } catch {
    return null;
  }
}

// ---- Structure ("Rapikan dengan AI") -------------------------------------------------

const draftOutputSchema = z.object({
  title: z.unknown(),
  summary: z.unknown(),
  problem: z.unknown().optional(),
  targetMarket: z.unknown().optional(),
  solution: z.unknown().optional(),
  agency: z.unknown().optional(),
});

export function parseDraft(text: string): BankIdeaDraft {
  const parsed = draftOutputSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new OutputError('format rapikan ide tidak sesuai');
  const value = parsed.data;
  const title = cut(value.title, BANK_IDEA_TITLE_MAX_LENGTH);
  const summary = cut(value.summary, BANK_IDEA_TEXT_MAX_LENGTH);
  if (!title || !summary) throw new OutputError('judul atau ringkasan kosong');
  const agency = (BANK_IDEA_AGENCIES as readonly string[]).includes(String(value.agency))
    ? (value.agency as BankIdeaAgency)
    : 'other';
  return {
    title,
    summary,
    problem: cut(value.problem, BANK_IDEA_TEXT_MAX_LENGTH),
    targetMarket: cut(value.targetMarket, BANK_IDEA_TEXT_MAX_LENGTH),
    solution: cut(value.solution, BANK_IDEA_TEXT_MAX_LENGTH),
    agency,
  };
}

// ---- Research --------------------------------------------------------------------------

const researchOutputSchema = z.object({
  criteria: z.record(z.string(), z.unknown()),
  competitors: z.array(z.unknown()).optional(),
  summary: z.record(z.string(), z.unknown()).optional(),
});

const criterionOutputSchema = z.object({
  score: z.coerce.number(),
  confidence: z.unknown().optional(),
  reason: z.unknown().optional(),
  sources: z.array(z.unknown()).optional(),
});

const CONFIDENCE_ALIASES: Record<string, BankIdeaConfidence> = {
  low: 'low',
  rendah: 'low',
  medium: 'medium',
  sedang: 'medium',
  high: 'high',
  tinggi: 'high',
};

function parseSources(value: unknown[] | undefined): BankIdeaSource[] {
  const seen = new Set<string>();
  const sources: BankIdeaSource[] = [];
  for (const item of value ?? []) {
    const record = (typeof item === 'object' && item !== null ? item : {}) as Record<
      string,
      unknown
    >;
    const url = safeUrl(typeof item === 'string' ? item : record.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ title: cut(record.title, 200) || new URL(url).hostname, url });
    if (sources.length >= MAX_SOURCES) break;
  }
  return sources;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => cut(item, MAX_ITEM))
        .filter(Boolean)
        .slice(0, MAX_LIST_ITEMS)
    : [];
}

export interface ParsedResearch {
  criteria: Map<BankIdeaCriterion, BankIdeaCriterionResult>;
  competitors: BankIdeaCompetitor[];
  summary: BankIdeaResearchResult['summary'];
}

export function parseResearch(text: string): ParsedResearch {
  const parsed = researchOutputSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new OutputError('format hasil riset tidak sesuai');

  const criteria = new Map<BankIdeaCriterion, BankIdeaCriterionResult>();
  const missing: string[] = [];
  for (const key of BANK_IDEA_CRITERIA) {
    const item = criterionOutputSchema.safeParse(parsed.data.criteria[key]);
    if (!item.success || !Number.isFinite(item.data.score)) {
      missing.push(key);
      continue;
    }
    const { score, confidence, reason, sources } = item.data;
    criteria.set(key, {
      key,
      score: Math.min(10, Math.max(1, Math.round(score))),
      confidence: CONFIDENCE_ALIASES[String(confidence).toLowerCase()] ?? 'low',
      reason: cut(reason, MAX_REASON) || 'Tidak ada alasan yang diberikan.',
      sources: parseSources(sources),
    });
  }
  if (missing.length > 0) throw new OutputError(`kriteria hilang: ${missing.join(', ')}`);

  const competitors: BankIdeaCompetitor[] = [];
  for (const item of parsed.data.competitors ?? []) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const name = cut(record.name, 200);
    if (!name) continue;
    competitors.push({ name, url: safeUrl(record.url), note: cut(record.note, MAX_ITEM) });
    if (competitors.length >= MAX_COMPETITORS) break;
  }

  const summary = parsed.data.summary ?? {};
  return {
    criteria,
    competitors,
    summary: {
      verdict: cut(summary.verdict, 1_000),
      strengths: list(summary.strengths),
      risks: list(summary.risks),
      nextSteps: list(summary.nextSteps),
    },
  };
}

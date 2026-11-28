import { z } from 'zod';

/**
 * Bank Idea — stores every idea, researches it on the web with AI (trend, market size,
 * competition, monetization) and scores it 0–100 with the reasons and sources.
 *
 * Scoring (rubric v1): 9 criteria scored 1–10 by the AI, grouped in 4 weighted
 * dimensions. The API computes the dimension averages, the total and the label —
 * never the AI. See BANK_IDEA_RUBRIC.
 */

// ---- Idea fields ---------------------------------------------------------------------

export const BANK_IDEA_MARKET_SCOPES = ['indonesia', 'global'] as const;
export type BankIdeaMarketScope = (typeof BANK_IDEA_MARKET_SCOPES)[number];
export const BANK_IDEA_MARKET_SCOPE_LABELS: Record<BankIdeaMarketScope, string> = {
  indonesia: 'Indonesia',
  global: 'Global',
};

/** `researched` is set automatically by the first successful research; `executed` by hand. */
export const BANK_IDEA_STAGES = ['new', 'researched', 'executed'] as const;
export type BankIdeaStage = (typeof BANK_IDEA_STAGES)[number];
export const BANK_IDEA_STAGE_LABELS: Record<BankIdeaStage, string> = {
  new: 'Baru',
  researched: 'Diriset',
  executed: 'Dieksekusi',
};

export const BANK_IDEA_RAW_MAX_LENGTH = 10_000;
export const BANK_IDEA_TITLE_MAX_LENGTH = 200;
export const BANK_IDEA_TEXT_MAX_LENGTH = 2_000;

// ---- Rubric --------------------------------------------------------------------------

export const BANK_IDEA_RUBRIC_VERSION = 'v1';

export const BANK_IDEA_CRITERIA = [
  'trend_direction',
  'momentum',
  'market_size',
  'market_growth',
  'market_gap',
  'differentiation',
  'willingness_to_pay',
  'pricing_model',
  'time_to_revenue',
] as const;
export type BankIdeaCriterion = (typeof BANK_IDEA_CRITERIA)[number];

export const BANK_IDEA_DIMENSIONS = ['trend', 'market', 'competition', 'monetization'] as const;
export type BankIdeaDimension = (typeof BANK_IDEA_DIMENSIONS)[number];

export interface BankIdeaCriterionDefinition {
  key: BankIdeaCriterion;
  label: string;
  /** What is judged, shown in the UI and given to the AI. */
  question: string;
  /** Anchors for 1–2, 3–4, 5–6, 7–8, 9–10 so scores stay consistent between ideas. */
  anchors: readonly [string, string, string, string, string];
}

export interface BankIdeaDimensionDefinition {
  key: BankIdeaDimension;
  label: string;
  /** Percent; all weights add up to 100. */
  weight: number;
  criteria: readonly BankIdeaCriterionDefinition[];
}

export const BANK_IDEA_RUBRIC: readonly BankIdeaDimensionDefinition[] = [
  {
    key: 'trend',
    label: 'Tren & Timing',
    weight: 25,
    criteria: [
      {
        key: 'trend_direction',
        label: 'Arah tren',
        question:
          'Apakah minat/permintaan terhadap masalah atau solusi ini naik, stabil, atau turun?',
        anchors: [
          'Turun jelas',
          'Cenderung turun atau stagnan di level rendah',
          'Stabil',
          'Naik konsisten',
          'Naik tajam dengan bukti kuat',
        ],
      },
      {
        key: 'momentum',
        label: 'Momentum',
        question:
          'Apakah ada pemicu baru (teknologi, regulasi, perubahan kebiasaan) yang membuat ide ini tepat dijalankan sekarang?',
        anchors: [
          'Tidak ada pemicu, terlalu awal atau sudah terlambat',
          'Pemicu lemah',
          'Ada pemicu tapi umum',
          'Pemicu jelas dan relevan',
          'Pemicu baru yang kuat baru saja membuka peluang ini',
        ],
      },
    ],
  },
  {
    key: 'market',
    label: 'Ukuran Pasar',
    weight: 20,
    criteria: [
      {
        key: 'market_size',
        label: 'Besar pasar',
        question:
          'Seberapa besar segmen calon pembeli yang realistis dijangkau di cakupan pasar ini?',
        anchors: [
          'Sangat kecil atau niche sempit',
          'Kecil',
          'Menengah',
          'Besar',
          'Sangat besar dengan data pendukung',
        ],
      },
      {
        key: 'market_growth',
        label: 'Pertumbuhan pasar',
        question: 'Seberapa cepat pasar ini tumbuh?',
        anchors: [
          'Menyusut',
          'Hampir tidak tumbuh',
          'Tumbuh pelan',
          'Tumbuh sehat (sekitar 10–20% per tahun)',
          'Tumbuh cepat (di atas 20% per tahun)',
        ],
      },
    ],
  },
  {
    key: 'competition',
    label: 'Kompetisi',
    weight: 25,
    criteria: [
      {
        key: 'market_gap',
        label: 'Celah pasar',
        question:
          'Seberapa besar celah yang belum diisi kompetitor? (Makin kosong pasarnya, makin tinggi skornya.)',
        anchors: [
          'Sangat jenuh, dikuasai pemain besar',
          'Ramai, celah sempit',
          'Kompetitor ada tapi masih ada celah',
          'Sedikit kompetitor yang memadai',
          'Hampir tidak ada solusi yang memadai',
        ],
      },
      {
        key: 'differentiation',
        label: 'Diferensiasi',
        question: 'Seberapa kuat dan sulit ditiru pembeda ide ini dibanding yang sudah ada?',
        anchors: [
          'Tidak ada pembeda',
          'Pembeda tipis',
          'Pembeda kecil dan mudah ditiru',
          'Pembeda jelas',
          'Pembeda kuat dan sulit ditiru',
        ],
      },
    ],
  },
  {
    key: 'monetization',
    label: 'Monetisasi',
    weight: 30,
    criteria: [
      {
        key: 'willingness_to_pay',
        label: 'Kemauan bayar',
        question: 'Apakah calon pembeli mau dan mampu membayar untuk solusi seperti ini?',
        anchors: [
          'Tidak mau bayar',
          'Enggan bayar, ekspektasi gratis',
          'Mau bayar dengan harga rendah',
          'Mau bayar, ada bukti dari solusi serupa',
          'Terbukti membayar mahal untuk solusi serupa',
        ],
      },
      {
        key: 'pricing_model',
        label: 'Model & harga',
        question: 'Seberapa jelas cara ide ini menghasilkan uang dan patokan harganya?',
        anchors: [
          'Tidak jelas cara menghasilkan uang',
          'Ada gambaran tapi lemah',
          'Ada model tapi belum teruji',
          'Model jelas dengan patokan harga pasar',
          'Model dan harga jelas serta sudah terbukti di pasar',
        ],
      },
      {
        key: 'time_to_revenue',
        label: 'Waktu ke pendapatan pertama',
        question:
          'Seberapa cepat ide ini bisa menghasilkan pendapatan pertama dan seberapa besar modal awalnya?',
        anchors: [
          'Lebih dari 12 bulan atau butuh modal sangat besar',
          '6–12 bulan',
          '3–6 bulan',
          '1–3 bulan',
          'Kurang dari 1 bulan dengan modal kecil',
        ],
      },
    ],
  },
];

/** Labels of the total score. A red-flag dimension caps the label at `validate`. */
export const BANK_IDEA_LABELS = ['execute', 'validate', 'park'] as const;
export type BankIdeaLabel = (typeof BANK_IDEA_LABELS)[number];
export const BANK_IDEA_LABEL_TEXT: Record<BankIdeaLabel, string> = {
  execute: 'Layak dieksekusi',
  validate: 'Perlu validasi',
  park: 'Simpan dulu',
};
export const BANK_IDEA_EXECUTE_MIN_SCORE = 75;
export const BANK_IDEA_VALIDATE_MIN_SCORE = 50;
/** A dimension at or below this (scale 1–10) is a red flag. */
export const BANK_IDEA_RED_FLAG_MAX = 3;

export const BANK_IDEA_CONFIDENCES = ['low', 'medium', 'high'] as const;
export type BankIdeaConfidence = (typeof BANK_IDEA_CONFIDENCES)[number];
export const BANK_IDEA_CONFIDENCE_LABELS: Record<BankIdeaConfidence, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
};

// ---- Requests ------------------------------------------------------------------------

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} wajib diisi` })
    .trim()
    .min(1, `${label} wajib diisi`)
    .max(max, `${label} maksimal ${max.toLocaleString('id-ID')} karakter`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} maksimal ${max.toLocaleString('id-ID')} karakter`);

const marketScopeSchema = z.enum(BANK_IDEA_MARKET_SCOPES, { error: 'Cakupan pasar tidak dikenal' });

export const bankIdeaRawInputSchema = z
  .string({ error: 'Ide mentah wajib diisi' })
  .trim()
  .min(10, 'Tulis idenya minimal 10 karakter')
  .max(
    BANK_IDEA_RAW_MAX_LENGTH,
    `Ide mentah maksimal ${BANK_IDEA_RAW_MAX_LENGTH.toLocaleString('id-ID')} karakter`,
  );

export const structureBankIdeaRequestSchema = z.object({ rawInput: bankIdeaRawInputSchema });
export type StructureBankIdeaRequest = z.infer<typeof structureBankIdeaRequestSchema>;

/** Editable fields without defaults (PATCH sends only what changed). */
const contentFields = {
  title: requiredText('Judul', BANK_IDEA_TITLE_MAX_LENGTH),
  summary: requiredText('Ringkasan', BANK_IDEA_TEXT_MAX_LENGTH),
  problem: optionalText('Masalah', BANK_IDEA_TEXT_MAX_LENGTH),
  solution: optionalText('Solusi', BANK_IDEA_TEXT_MAX_LENGTH),
  marketScope: marketScopeSchema,
};

export const bankIdeaContentSchema = z.object({
  ...contentFields,
  problem: contentFields.problem.default(''),
  solution: contentFields.solution.default(''),
  marketScope: marketScopeSchema.default('indonesia'),
});
export type BankIdeaContent = z.infer<typeof bankIdeaContentSchema>;

/** The draft the AI makes from raw text; the user edits it before saving. */
export const bankIdeaDraftSchema = z.object({
  title: contentFields.title,
  summary: contentFields.summary,
  problem: contentFields.problem,
  solution: contentFields.solution,
});
export type BankIdeaDraft = z.infer<typeof bankIdeaDraftSchema>;
export const structureBankIdeaResponseSchema = z.object({ draft: bankIdeaDraftSchema });
export type StructureBankIdeaResponse = z.infer<typeof structureBankIdeaResponseSchema>;

export const createBankIdeaRequestSchema = bankIdeaContentSchema.extend({
  rawInput: z
    .string()
    .trim()
    .max(BANK_IDEA_RAW_MAX_LENGTH, 'Ide mentah terlalu panjang')
    .default(''),
  /** "Simpan & Riset": queue a research right after saving. */
  research: z.boolean().default(false),
});
export type CreateBankIdeaRequest = z.input<typeof createBankIdeaRequestSchema>;

export const updateBankIdeaRequestSchema = z
  .object({
    title: contentFields.title.optional(),
    summary: contentFields.summary.optional(),
    problem: contentFields.problem.optional(),
    solution: contentFields.solution.optional(),
    marketScope: contentFields.marketScope.optional(),
    /** "Tandai dieksekusi" / undo. */
    executed: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Tidak ada perubahan',
  });
export type UpdateBankIdeaRequest = z.input<typeof updateBankIdeaRequestSchema>;

export const BANK_IDEA_LIST_FILTERS = ['active', 'archived'] as const;
export type BankIdeaListFilter = (typeof BANK_IDEA_LIST_FILTERS)[number];
export const bankIdeaListQuerySchema = z.object({
  filter: z.enum(BANK_IDEA_LIST_FILTERS, { error: 'Filter tidak dikenal' }).default('active'),
});

// ---- Research results ----------------------------------------------------------------

export const bankIdeaSourceSchema = z.object({ title: z.string(), url: z.string() });
export type BankIdeaSource = z.infer<typeof bankIdeaSourceSchema>;

export const bankIdeaCriterionResultSchema = z.object({
  key: z.enum(BANK_IDEA_CRITERIA),
  score: z.number().int().min(1).max(10),
  confidence: z.enum(BANK_IDEA_CONFIDENCES),
  reason: z.string(),
  sources: z.array(bankIdeaSourceSchema),
});
export type BankIdeaCriterionResult = z.infer<typeof bankIdeaCriterionResultSchema>;

export const bankIdeaDimensionResultSchema = z.object({
  key: z.enum(BANK_IDEA_DIMENSIONS),
  weight: z.number(),
  /** Average of its criteria, 1–10, one decimal. */
  score: z.number(),
  redFlag: z.boolean(),
  criteria: z.array(bankIdeaCriterionResultSchema),
});
export type BankIdeaDimensionResult = z.infer<typeof bankIdeaDimensionResultSchema>;

export const bankIdeaCompetitorSchema = z.object({
  name: z.string(),
  url: z.string().nullable(),
  note: z.string(),
});
export type BankIdeaCompetitor = z.infer<typeof bankIdeaCompetitorSchema>;

/**
 * A potential target market found by the research. The list is ranked; the first
 * segment is the one every score was computed for.
 */
export const bankIdeaTargetSegmentSchema = z.object({
  segment: z.string(),
  reason: z.string(),
  /** Rough size with its unit (e.g. "±2,1 juta rumah tangga"), or null without data. */
  sizeEstimate: z.string().nullable(),
  sources: z.array(bankIdeaSourceSchema),
});
export type BankIdeaTargetSegment = z.infer<typeof bankIdeaTargetSegmentSchema>;

export const bankIdeaResearchResultSchema = z.object({
  rubricVersion: z.string(),
  totalScore: z.number().int(),
  label: z.enum(BANK_IDEA_LABELS),
  /** The label would have been higher without a red flag. */
  cappedByRedFlag: z.boolean(),
  dimensions: z.array(bankIdeaDimensionResultSchema),
  competitors: z.array(bankIdeaCompetitorSchema),
  /** Ranked potential target markets; missing on researches made before this existed. */
  targetSegments: z.array(bankIdeaTargetSegmentSchema).optional(),
  summary: z.object({
    verdict: z.string(),
    strengths: z.array(z.string()),
    risks: z.array(z.string()),
    nextSteps: z.array(z.string()),
  }),
});
export type BankIdeaResearchResult = z.infer<typeof bankIdeaResearchResultSchema>;

// ---- Research runs -------------------------------------------------------------------

export const BANK_IDEA_RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type BankIdeaRunStatus = (typeof BANK_IDEA_RUN_STATUSES)[number];

const isoDate = z.string();

export const bankIdeaRunSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  status: z.enum(BANK_IDEA_RUN_STATUSES),
  marketScope: z.enum(BANK_IDEA_MARKET_SCOPES),
  totalScore: z.number().int().nullable(),
  label: z.enum(BANK_IDEA_LABELS).nullable(),
  result: bankIdeaResearchResultSchema.nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: isoDate,
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
});
export type BankIdeaRunDto = z.infer<typeof bankIdeaRunSchema>;

/** A queued/running research and its place in the global queue (1 = next / running). */
export const bankIdeaActiveRunSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running']),
  queuePosition: z.number().int(),
  createdAt: isoDate,
  startedAt: isoDate.nullable(),
});
export type BankIdeaActiveRunDto = z.infer<typeof bankIdeaActiveRunSchema>;

// ---- Ideas ---------------------------------------------------------------------------

export const bankIdeaSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  marketScope: z.enum(BANK_IDEA_MARKET_SCOPES),
  stage: z.enum(BANK_IDEA_STAGES),
  latestScore: z.number().int().nullable(),
  latestLabel: z.enum(BANK_IDEA_LABELS).nullable(),
  lastResearchedAt: isoDate.nullable(),
  /** Content edited after the latest successful research. */
  changedSinceResearch: z.boolean(),
  activeRun: bankIdeaActiveRunSchema.nullable(),
  archivedAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type BankIdeaSummaryDto = z.infer<typeof bankIdeaSummarySchema>;

export const bankIdeaSchema = bankIdeaSummarySchema.extend({
  rawInput: z.string(),
  problem: z.string(),
  solution: z.string(),
  updatedAt: isoDate,
});
export type BankIdeaDto = z.infer<typeof bankIdeaSchema>;

export const bankIdeaListResponseSchema = z.object({ items: z.array(bankIdeaSummarySchema) });
export type BankIdeaListResponse = z.infer<typeof bankIdeaListResponseSchema>;

export const bankIdeaResponseSchema = z.object({ idea: bankIdeaSchema });
export type BankIdeaResponse = z.infer<typeof bankIdeaResponseSchema>;

/** Detail page: the idea plus every research run, newest first. */
export const bankIdeaDetailResponseSchema = z.object({
  idea: bankIdeaSchema,
  runs: z.array(bankIdeaRunSchema),
});
export type BankIdeaDetailResponse = z.infer<typeof bankIdeaDetailResponseSchema>;

/** Polled while a research is queued or running. */
export const bankIdeaResearchStatusResponseSchema = z.object({
  activeRun: bankIdeaActiveRunSchema.nullable(),
  /** Latest finished run (to detect completion), or null. */
  lastFinishedRunId: z.string().nullable(),
});
export type BankIdeaResearchStatusResponse = z.infer<typeof bankIdeaResearchStatusResponseSchema>;

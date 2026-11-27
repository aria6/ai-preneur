import {
  BANK_IDEA_EXECUTE_MIN_SCORE,
  BANK_IDEA_RED_FLAG_MAX,
  BANK_IDEA_RUBRIC,
  BANK_IDEA_RUBRIC_VERSION,
  BANK_IDEA_VALIDATE_MIN_SCORE,
  type BankIdeaCompetitor,
  type BankIdeaCriterion,
  type BankIdeaCriterionResult,
  type BankIdeaLabel,
  type BankIdeaResearchResult,
} from '@ai-preneur/shared';

/**
 * Pure scoring rules (rubric v1). The AI only scores the 9 criteria 1–10; everything
 * here is deterministic so two researches with the same criterion scores always get
 * the same total and label.
 */

const round1 = (value: number) => Math.round(value * 10) / 10;

export function labelFor(totalScore: number): BankIdeaLabel {
  if (totalScore >= BANK_IDEA_EXECUTE_MIN_SCORE) return 'execute';
  if (totalScore >= BANK_IDEA_VALIDATE_MIN_SCORE) return 'validate';
  return 'park';
}

export function computeResearchResult(input: {
  criteria: ReadonlyMap<BankIdeaCriterion, BankIdeaCriterionResult>;
  competitors: BankIdeaCompetitor[];
  summary: BankIdeaResearchResult['summary'];
}): BankIdeaResearchResult {
  const dimensions = BANK_IDEA_RUBRIC.map((dimension) => {
    const criteria = dimension.criteria.map((definition) => {
      const result = input.criteria.get(definition.key);
      if (!result) throw new Error(`Missing criterion ${definition.key}`);
      return result;
    });
    const score = round1(criteria.reduce((sum, c) => sum + c.score, 0) / criteria.length);
    return {
      key: dimension.key,
      weight: dimension.weight,
      score,
      redFlag: score <= BANK_IDEA_RED_FLAG_MAX,
      criteria,
    };
  });

  // Σ weight% × dimension score (1–10) × 10 → 0–100.
  const totalScore = Math.round(
    dimensions.reduce((sum, d) => sum + (d.weight / 100) * d.score * 10, 0),
  );
  const raw = labelFor(totalScore);
  const hasRedFlag = dimensions.some((d) => d.redFlag);
  const label: BankIdeaLabel = hasRedFlag && raw === 'execute' ? 'validate' : raw;

  return {
    rubricVersion: BANK_IDEA_RUBRIC_VERSION,
    totalScore,
    label,
    cappedByRedFlag: label !== raw,
    dimensions,
    competitors: input.competitors,
    summary: input.summary,
  };
}

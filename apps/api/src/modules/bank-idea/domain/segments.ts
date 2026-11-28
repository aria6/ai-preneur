import {
  bankIdeaSegmentKey,
  type BankIdeaResearchResult,
  type BankIdeaRunDto,
  type BankIdeaSegmentSummaryDto,
  type BankIdeaTargetSegment,
} from '@ai-preneur/shared';

/** The segment a result's 9 criteria were computed for (older results: the first one). */
export function scoredSegmentOf(result: BankIdeaResearchResult): BankIdeaTargetSegment | undefined {
  const segments = result.targetSegments ?? [];
  return segments.find((s) => s.scored) ?? segments[0];
}

/**
 * The idea's target markets across every successful version, merged by
 * `bankIdeaSegmentKey` (the first wording seen is kept). For each: the latest screening
 * and the latest full research computed for it. Ranked by screening, best first;
 * segments without a screening last.
 */
export function ideaSegments(runs: BankIdeaRunDto[]): BankIdeaSegmentSummaryDto[] {
  const byKey = new Map<string, BankIdeaSegmentSummaryDto>();
  const ordered = runs
    .filter((run) => run.status === 'succeeded' && run.result)
    .toSorted((a, b) => a.version - b.version);

  for (const run of ordered) {
    const result = run.result!;
    const scored = scoredSegmentOf(result);
    for (const segment of result.targetSegments ?? []) {
      const key = bankIdeaSegmentKey(segment.segment);
      const entry = byKey.get(key) ?? {
        segment: segment.segment,
        screening: null,
        screeningVersion: null,
        fullRunId: null,
        fullVersion: null,
        fullScore: null,
        fullLabel: null,
      };
      if (segment.screening) {
        entry.screening = segment.screening;
        entry.screeningVersion = run.version;
      }
      if (segment === scored) {
        entry.fullRunId = run.id;
        entry.fullVersion = run.version;
        entry.fullScore = result.totalScore;
        entry.fullLabel = result.label;
      }
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()].toSorted(
    (a, b) => (b.screening?.score ?? -1) - (a.screening?.score ?? -1),
  );
}

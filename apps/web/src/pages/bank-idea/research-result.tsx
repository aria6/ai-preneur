import {
  BANK_IDEA_CONFIDENCE_LABELS,
  BANK_IDEA_LABEL_TEXT,
  BANK_IDEA_MARKET_SCOPE_LABELS,
  BANK_IDEA_RUBRIC,
  BANK_IDEA_RED_FLAG_MAX,
  type BankIdeaConfidence,
  type BankIdeaDimensionResult,
  type BankIdeaRunDto,
  type BankIdeaResearchResult,
  type BankIdeaTargetSegment,
} from '@ai-preneur/shared';
import type { ReactNode } from 'react';

import { Alert, Badge, Card } from '../../components/ui/feedback';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { formatDateTime } from '../../lib/format';
import { LABEL_STYLES, ScoreCircle } from './bank-idea-ui';

const DIMENSIONS = new Map(BANK_IDEA_RUBRIC.map((d) => [d.key, d]));
const CRITERIA = new Map(
  BANK_IDEA_RUBRIC.flatMap((d) => d.criteria.map((c) => [c.key, c] as const)),
);

const CONFIDENCE_COLOR: Record<BankIdeaConfidence, 'red' | 'amber' | 'green'> = {
  low: 'red',
  medium: 'amber',
  high: 'green',
};

function barColor(score: number): string {
  if (score <= BANK_IDEA_RED_FLAG_MAX) return 'bg-red-500';
  if (score < 5) return 'bg-amber-500';
  if (score < 7.5) return 'bg-sky-500';
  return 'bg-emerald-500';
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="h-2 w-full rounded-full bg-slate-100" aria-hidden="true">
      <div
        className={cn('h-2 rounded-full', barColor(score))}
        style={{ width: `${score * 10}%` }}
      />
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1 text-primary-700 hover:underline"
    >
      {children}
      <Icon name="external" className="size-3 shrink-0" />
    </a>
  );
}

function DimensionCard({ dimension }: { dimension: BankIdeaDimensionResult }) {
  const definition = DIMENSIONS.get(dimension.key);
  return (
    <div
      id={`dimensi-${dimension.key}`}
      className="scroll-mt-4 rounded-xl border border-slate-200 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">{definition?.label ?? dimension.key}</h3>
          <p className="text-xs text-slate-500">Bobot {dimension.weight}%</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">
            {dimension.score.toLocaleString('id-ID')}
            <span className="text-sm font-normal text-slate-400">/10</span>
          </p>
          {dimension.redFlag && <Badge color="red">Red flag</Badge>}
        </div>
      </div>
      <div className="mt-2">
        <ScoreBar score={dimension.score} />
      </div>

      <ul className="mt-4 space-y-4 border-t border-slate-100 pt-4">
        {dimension.criteria.map((criterion) => {
          const info = CRITERIA.get(criterion.key);
          return (
            <li key={criterion.key}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">{info?.label ?? criterion.key}</p>
                <div className="flex items-center gap-2">
                  <Badge color={CONFIDENCE_COLOR[criterion.confidence]}>
                    Keyakinan {BANK_IDEA_CONFIDENCE_LABELS[criterion.confidence].toLowerCase()}
                  </Badge>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums">
                    {criterion.score}/10
                  </span>
                </div>
              </div>
              <div className="mt-1.5">
                <ScoreBar score={criterion.score} />
              </div>
              <p className="mt-2 text-sm whitespace-pre-line text-slate-600">{criterion.reason}</p>
              {criterion.sources.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs">
                  {criterion.sources.map((source) => (
                    <li key={source.url} className="truncate">
                      <ExternalLink href={source.url}>{source.title}</ExternalLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BulletCard({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: 'check' | 'alert' | 'chevronRight';
}) {
  return (
    <Card className="p-5">
      <h3 className="mb-3 font-semibold text-slate-900">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">—</p>
      ) : (
        <ul className="space-y-2 text-sm text-slate-600">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <Icon name={icon} className="mt-0.5 size-4 shrink-0 text-slate-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- Detail panels (shown in modals) ---------------------------------------------------

export function TargetSegmentsPanel({ segments }: { segments: BankIdeaTargetSegment[] }) {
  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        Diurutkan dari yang paling menjanjikan. Skor dihitung untuk segmen #1.
      </p>
      <ol className="space-y-5">
        {segments.map((segment, index) => (
          <li key={segment.segment} className="flex gap-3">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                index === 0 ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600',
              )}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{segment.segment}</p>
              {segment.sizeEstimate && (
                <p className="text-xs text-slate-500">Perkiraan ukuran: {segment.sizeEstimate}</p>
              )}
              {segment.reason && (
                <p className="mt-1.5 text-sm whitespace-pre-line text-slate-600">
                  {segment.reason}
                </p>
              )}
              {segment.sources.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {segment.sources.map((source) => (
                    <li key={source.url} className="truncate">
                      <ExternalLink href={source.url}>{source.title}</ExternalLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CriteriaPanel({ result }: { result: BankIdeaResearchResult }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {result.dimensions.map((dimension) => (
        <DimensionCard key={dimension.key} dimension={dimension} />
      ))}
    </div>
  );
}

export function CompetitorsPanel({ result }: { result: BankIdeaResearchResult }) {
  if (result.competitors.length === 0) {
    return <p className="text-sm text-slate-400">Tidak ada kompetitor yang ditemukan.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-2 pr-4 font-medium">Nama</th>
            <th className="py-2 font-medium">Catatan</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {result.competitors.map((competitor) => (
            <tr key={competitor.name} className="align-top">
              <td className="py-2 pr-4 font-medium whitespace-nowrap text-slate-800">
                {competitor.url ? (
                  <ExternalLink href={competitor.url}>{competitor.name}</ExternalLink>
                ) : (
                  competitor.name
                )}
              </td>
              <td className="py-2 text-slate-600">{competitor.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Summary (main column) --------------------------------------------------------------

/** Score, dimension bars and strengths/risks/next steps. Details open in modals. */
export function ResearchSummary({
  run,
  result,
  outdated,
  onOpenDimension,
}: {
  run: BankIdeaRunDto;
  result: BankIdeaResearchResult;
  outdated: boolean;
  onOpenDimension: (key: string) => void;
}) {
  const redFlags = result.dimensions.filter((d) => d.redFlag);
  const primarySegment = result.targetSegments?.[0];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ScoreCircle score={result.totalScore} label={result.label} size="lg" />
          <div className="min-w-0 flex-1">
            <p className={cn('text-lg font-semibold', LABEL_STYLES[result.label].text)}>
              {BANK_IDEA_LABEL_TEXT[result.label]}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Riset versi {run.version} · Pasar {BANK_IDEA_MARKET_SCOPE_LABELS[run.marketScope]} ·{' '}
              {formatDateTime(run.finishedAt)} · Rubrik {result.rubricVersion}
            </p>
            {primarySegment && (
              <p className="mt-2 text-sm text-slate-600">
                <span className="text-slate-500">Dihitung untuk:</span>{' '}
                <span className="font-medium text-slate-800">{primarySegment.segment}</span>
              </p>
            )}
            {result.summary.verdict && (
              <p className="mt-3 text-sm whitespace-pre-line text-slate-700">
                {result.summary.verdict}
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
          {result.dimensions.map((dimension) => (
            <button
              key={dimension.key}
              type="button"
              onClick={() => onOpenDimension(dimension.key)}
              className="rounded-lg p-2 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary-500"
              title="Lihat detail"
            >
              <p className="text-xs text-slate-500">
                {DIMENSIONS.get(dimension.key)?.label} · {dimension.weight}%
              </p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums">
                {dimension.score.toLocaleString('id-ID')}/10
                {dimension.redFlag && <span className="ml-1 text-xs text-red-600">red flag</span>}
              </p>
              <div className="mt-1">
                <ScoreBar score={dimension.score} />
              </div>
            </button>
          ))}
        </div>
      </Card>

      {redFlags.length > 0 && (
        <Alert variant="warning">
          Red flag: {redFlags.map((d) => DIMENSIONS.get(d.key)?.label).join(', ')} bernilai ≤{' '}
          {BANK_IDEA_RED_FLAG_MAX}/10.
          {result.cappedByRedFlag &&
            ' Karena itu labelnya dibatasi "Perlu validasi" walaupun total skornya tinggi.'}
        </Alert>
      )}
      {outdated && (
        <Alert variant="info">
          Ide sudah diubah setelah riset ini. Jalankan riset ulang agar skornya sesuai isi terbaru.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <BulletCard title="Kekuatan" items={result.summary.strengths} icon="check" />
        <BulletCard title="Risiko terbesar" items={result.summary.risks} icon="alert" />
        <BulletCard
          title="Langkah validasi berikutnya"
          items={result.summary.nextSteps}
          icon="chevronRight"
        />
      </div>
    </div>
  );
}

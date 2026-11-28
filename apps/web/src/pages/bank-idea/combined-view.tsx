import {
  bankIdeaSegmentKey,
  BANK_IDEA_LABEL_TEXT,
  type BankIdeaSegmentSummaryDto,
  type BankIdeaSynthesisDto,
} from '@ai-preneur/shared';

import { Button } from '../../components/ui/Button';
import { Alert, Card } from '../../components/ui/feedback';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/cn';
import { formatDateTime } from '../../lib/format';
import { LABEL_STYLES, LabelBadge } from './bank-idea-ui';

function Bullets({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: 'check' | 'alert' | 'chevronRight';
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">{title}</h3>
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
    </div>
  );
}

function SynthesisCard({
  synthesis,
  segments,
  versionCount,
  generate,
  busy,
}: {
  synthesis: BankIdeaSynthesisDto;
  segments: BankIdeaSegmentSummaryDto[];
  versionCount: number;
  /** Null when the user may not run it (no permission, archived, …). */
  generate: (() => void) | null;
  busy: boolean;
}) {
  const result = synthesis.result;
  const running = synthesis.status === 'running';
  const recommended = result?.recommendedSegment
    ? segments.find(
        (s) => bankIdeaSegmentKey(s.segment) === bankIdeaSegmentKey(result.recommendedSegment!),
      )
    : undefined;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Kesimpulan gabungan</h2>
          <p className="text-xs text-slate-500">
            {result && synthesis.createdAt
              ? `Dibuat ${formatDateTime(synthesis.createdAt)} · dari ${result.versions.map((v) => `v${v}`).join(', ')}`
              : `Merangkum ${versionCount} versi riset menjadi satu kesimpulan`}
          </p>
        </div>
        {generate && (
          <Button
            variant={result ? 'secondary' : 'primary'}
            size="sm"
            onClick={generate}
            loading={busy}
            disabled={running}
          >
            <Icon name={result ? 'refresh' : 'sparkles'} className="size-4" />
            {result ? 'Perbarui' : 'Buat kesimpulan gabungan'}
          </Button>
        )}
      </div>

      {running && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
          <Spinner className="size-4" /> Menyusun kesimpulan dari semua versi… biasanya kurang dari
          1 menit.
        </div>
      )}
      {synthesis.status === 'failed' && synthesis.errorMessage && (
        <Alert className="mt-4">Gagal menyusun kesimpulan: {synthesis.errorMessage}</Alert>
      )}
      {result && synthesis.outdated && !running && (
        <Alert variant="warning" className="mt-4">
          Ada riset baru setelah kesimpulan ini dibuat. Klik Perbarui agar ikut dihitung.
        </Alert>
      )}

      {!result && !running && (
        <p className="mt-4 text-sm text-slate-500">
          AI membaca semua versi riset (tanpa pencarian web), lalu menentukan segmen yang paling
          layak dimulai beserta kekuatan, risiko, dan langkah validasinya.
        </p>
      )}

      {result && (
        <>
          <p className="mt-4 text-xs text-slate-500">Mulai dari</p>
          {result.recommendedSegment ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">{result.recommendedSegment}</p>
              {recommended && recommended.fullScore !== null && recommended.fullLabel && (
                <span
                  className={cn(
                    'text-sm font-semibold tabular-nums',
                    LABEL_STYLES[recommended.fullLabel].text,
                  )}
                >
                  {recommended.fullScore} · {BANK_IDEA_LABEL_TEXT[recommended.fullLabel]}
                </span>
              )}
            </div>
          ) : (
            <p className="mt-0.5 text-sm font-medium text-slate-700">
              Belum ada segmen yang layak dimulai.
            </p>
          )}
          <p className="mt-3 text-sm whitespace-pre-line text-slate-700">{result.verdict}</p>

          <div className="mt-4 grid gap-5 border-t border-slate-100 pt-4 lg:grid-cols-3">
            <Bullets title="Kekuatan" items={result.strengths} icon="check" />
            <Bullets title="Risiko terbesar" items={result.risks} icon="alert" />
            <Bullets
              title="Langkah validasi berikutnya"
              items={result.nextSteps}
              icon="chevronRight"
            />
          </div>

          {result.notes.length > 0 && (
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5">
              <p className="mb-1 text-xs font-medium text-slate-500">Catatan</p>
              <ul className="space-y-1 text-sm text-slate-600">
                {result.notes.map((note) => (
                  <li key={note} className="flex gap-2">
                    <Icon name="info" className="mt-0.5 size-4 shrink-0 text-slate-400" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function SegmentsTable({
  segments,
  viewRun,
  research,
}: {
  segments: BankIdeaSegmentSummaryDto[];
  viewRun: (runId: string) => void;
  /** Null when research is not possible right now. */
  research: ((segment: string) => void) | null;
}) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Perbandingan segmen</h2>
      <p className="text-xs text-slate-500">
        Semua target pasar dari semua versi, diurutkan dari skor saringan tertinggi. Skor lengkap =
        riset terbaru untuk segmen itu.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Segmen</th>
              <th className="py-2 pr-4 font-medium whitespace-nowrap">Saringan</th>
              <th className="py-2 pr-4 font-medium whitespace-nowrap">Skor lengkap</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {segments.map((segment) => (
              <tr key={segment.segment} className="align-top">
                <td className="py-2.5 pr-4 text-slate-800">{segment.segment}</td>
                <td className="py-2.5 pr-4 whitespace-nowrap tabular-nums">
                  {segment.screening ? (
                    <>
                      <span className="font-medium text-slate-900">
                        {segment.screening.score.toLocaleString('id-ID')}
                      </span>
                      <span className="text-xs text-slate-400">/10</span>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="py-2.5 pr-4 whitespace-nowrap">
                  {segment.fullScore !== null && segment.fullLabel ? (
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'font-semibold tabular-nums',
                          LABEL_STYLES[segment.fullLabel].text,
                        )}
                      >
                        {segment.fullScore}
                      </span>
                      <LabelBadge label={segment.fullLabel} />
                    </span>
                  ) : (
                    <span className="text-slate-400">Belum diriset</span>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {segment.fullRunId ? (
                    <Button variant="ghost" size="sm" onClick={() => viewRun(segment.fullRunId!)}>
                      Lihat v{segment.fullVersion}
                    </Button>
                  ) : (
                    research && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => research(segment.segment)}
                      >
                        <Icon name="search" className="size-4" /> Riset
                      </Button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function CombinedView(props: {
  segments: BankIdeaSegmentSummaryDto[];
  synthesis: BankIdeaSynthesisDto;
  versionCount: number;
  generate: (() => void) | null;
  generating: boolean;
  viewRun: (runId: string) => void;
  research: ((segment: string) => void) | null;
}) {
  return (
    <div className="space-y-6">
      <SynthesisCard
        synthesis={props.synthesis}
        segments={props.segments}
        versionCount={props.versionCount}
        generate={props.generate}
        busy={props.generating}
      />
      <SegmentsTable segments={props.segments} viewRun={props.viewRun} research={props.research} />
    </div>
  );
}

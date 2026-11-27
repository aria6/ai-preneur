import {
  COLLECTION_INITIAL_DAYS,
  DM_READABLE_MESSAGES,
  PERMISSIONS,
  type CollectionStatusDto,
  type PerformanceAccountDto,
} from '@ai-preneur/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button } from '../../../components/ui/Button';
import { Alert, Card } from '../../../components/ui/feedback';
import { Icon } from '../../../components/ui/Icon';
import { Spinner } from '../../../components/ui/Spinner';
import { useAuth } from '../../../hooks/use-auth';
import { cn } from '../../../lib/cn';
import { errorMessage } from '../../../lib/errors';
import { formatDateTime } from '../../../lib/format';
import * as analysisService from '../../../services/social-analysis.service';
import { formatMetric } from '../performance/performance-ui';
import { runResultText, STAGE_LABELS } from './analysis-ui';
import { CommentsTab } from './CommentsTab';
import { DmTab } from './DmTab';
import { RunsTab } from './RunsTab';

const POLL_MS = 3_000;

type View = 'comments' | 'dm' | 'runs';
const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'comments', label: 'Komentar' },
  { id: 'dm', label: 'DM' },
  { id: 'runs', label: 'Riwayat pengambilan' },
];

function useViewParam(): [View, (next: View) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('view');
  const view: View = raw === 'dm' || raw === 'runs' ? raw : 'comments';
  const setView = (next: View) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === 'comments') params.delete('view');
        else params.set('view', next);
        return params;
      },
      { replace: true },
    );
  return [view, setView];
}

function Limitations() {
  return (
    <details className="mt-4 text-xs text-slate-500">
      <summary className="cursor-pointer select-none text-slate-600 hover:text-slate-900">
        Batasan data dari Instagram
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Pengambilan pertama membaca postingan {COLLECTION_INITIAL_DAYS} hari terakhir; postingan
          yang lebih lama tidak diambil komentarnya.
        </li>
        <li>
          Instagram hanya memberi {DM_READABLE_MESSAGES} pesan terbaru per percakapan. Bila ada
          lebih dari {DM_READABLE_MESSAGES} pesan baru sejak pengambilan terakhir, pesan yang lebih
          lama tidak bisa diambil, dan percakapan itu diberi tanda. Perbarui data lebih sering agar
          lengkap.
        </li>
        <li>
          Percakapan di folder Permintaan (Requests) yang tidak aktif 30 hari tidak diberikan
          Instagram.
        </li>
        <li>Komentar atau pesan yang dihapus di Instagram tetap tersimpan di sini.</li>
        <li>
          Token perlu izin membaca komentar (<code>instagram_manage_comments</code>) dan DM (
          <code>instagram_manage_messages</code>); untuk token Instagram Login:{' '}
          <code>instagram_business_manage_comments</code> dan{' '}
          <code>instagram_business_manage_messages</code>.
        </li>
      </ul>
    </details>
  );
}

function StatusCard({
  status,
  account,
  canCollect,
  starting,
  startError,
  onStart,
}: {
  status: CollectionStatusDto;
  account: PerformanceAccountDto | undefined;
  canCollect: boolean;
  starting: boolean;
  startError: string | null;
  onStart: () => void;
}) {
  const { summary, currentRun, lastRun, blockedReason, nextKind } = status;
  const running = currentRun !== null;
  const stats = [
    { label: 'Postingan', value: summary?.postCount ?? 0 },
    { label: 'Komentar', value: summary?.commentCount ?? 0 },
    { label: 'Percakapan DM', value: summary?.conversationCount ?? 0 },
    { label: 'Pesan DM', value: summary?.messageCount ?? 0 },
  ];
  const buttonLabel =
    nextKind === 'initial'
      ? `Ambil data (${COLLECTION_INITIAL_DAYS} hari terakhir)`
      : 'Perbarui data';

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">
            Instagram{' '}
            {account?.username
              ? `@${account.username}`
              : summary?.username
                ? `@${summary.username}`
                : ''}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {summary?.lastSucceededAt
              ? `Terakhir diperbarui ${formatDateTime(summary.lastSucceededAt)}`
              : 'Data belum pernah diambil.'}
            {summary?.windowStart && ` · Postingan sejak ${formatDateTime(summary.windowStart)}`}
          </p>
        </div>
        {canCollect && (
          <Button
            onClick={onStart}
            loading={starting || running}
            disabled={blockedReason !== null}
            className="shrink-0"
          >
            {!starting && !running && <Icon name="refresh" className="size-4" />}
            {running ? 'Sedang mengambil…' : buttonLabel}
          </Button>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg bg-slate-50 px-3 py-2.5">
            <dt className="text-xs text-slate-500">{stat.label}</dt>
            <dd className="text-lg font-semibold text-slate-900 tabular-nums">
              {formatMetric(stat.value)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 space-y-2">
        {blockedReason && <Alert variant="warning">{blockedReason}</Alert>}
        {startError && <Alert>{startError}</Alert>}
        {currentRun ? (
          <Alert variant="info">
            <span className="flex items-center gap-2">
              <Spinner className="size-4" />
              <span>
                {currentRun.progressStage ? STAGE_LABELS[currentRun.progressStage] : 'Menyiapkan'}
                {currentRun.progressDetail && ` · ${currentRun.progressDetail}`}
                {' · '}
                {runResultText(currentRun)}
              </span>
            </span>
          </Alert>
        ) : (
          lastRun && (
            <>
              {lastRun.status === 'failed' ? (
                <Alert>
                  Pengambilan {formatDateTime(lastRun.startedAt)} gagal: {lastRun.errorMessage}
                  {lastRun.newComments + lastRun.newMessages > 0 &&
                    ` (${runResultText(lastRun)} sempat tersimpan)`}
                </Alert>
              ) : (
                <Alert variant="success">
                  Pengambilan {formatDateTime(lastRun.startedAt)} selesai: {runResultText(lastRun)}.
                </Alert>
              )}
              {lastRun.warnings.map((warning) => (
                <Alert key={warning} variant="warning">
                  {warning}
                </Alert>
              ))}
            </>
          )
        )}
        {summary && summary.incompleteConversationCount > 0 && (
          <p className="text-xs text-amber-700">
            {summary.incompleteConversationCount} percakapan punya pesan lama yang tidak bisa
            diambil.
          </p>
        )}
      </div>

      <Limitations />
    </Card>
  );
}

export function InstagramCollectionPanel({
  ideaId,
  account,
}: {
  ideaId: string;
  account: PerformanceAccountDto | undefined;
}) {
  const { can } = useAuth();
  const canCollect = can(PERMISSIONS.SOCIAL_ANALYSIS_COLLECT);
  const [view, setView] = useViewParam();
  const [status, setStatus] = useState<CollectionStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /** Bumped when a collection finishes, so the data below reloads. */
  const [dataVersion, setDataVersion] = useState(0);
  const runningRef = useRef(false);

  const applyStatus = useCallback((next: CollectionStatusDto) => {
    const wasRunning = runningRef.current;
    runningRef.current = next.currentRun !== null;
    if (wasRunning && !runningRef.current) setDataVersion((version) => version + 1);
    setStatus(next);
  }, []);

  const load = useCallback(
    (signal?: AbortSignal) =>
      analysisService
        .getCollectionStatus(ideaId, signal)
        .then((next) => {
          applyStatus(next);
          setLoadError(null);
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) setLoadError(errorMessage(error));
        }),
    [ideaId, applyStatus],
  );

  useEffect(() => {
    const controller = new AbortController();
    analysisService
      .getCollectionStatus(ideaId, controller.signal)
      .then(applyStatus)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      });
    return () => controller.abort();
  }, [ideaId, applyStatus]);

  const running = status?.currentRun !== null && status?.currentRun !== undefined;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, load]);

  const onStart = async () => {
    setStarting(true);
    setStartError(null);
    try {
      applyStatus(await analysisService.startCollection(ideaId));
    } catch (error) {
      setStartError(errorMessage(error));
      void load();
    } finally {
      setStarting(false);
    }
  };

  if (loadError && !status) return <Alert>{loadError}</Alert>;
  if (!status) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Spinner className="size-7" />
      </div>
    );
  }

  const hasData = status.summary !== null;
  return (
    <div className="space-y-4">
      <StatusCard
        status={status}
        account={account}
        canCollect={canCollect}
        starting={starting}
        startError={startError}
        onStart={() => void onStart()}
      />

      {hasData && (
        <div>
          <div
            role="tablist"
            aria-label="Data"
            className="mb-4 inline-flex rounded-lg border border-slate-300 bg-white p-0.5"
          >
            {VIEWS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={view === candidate.id}
                onClick={() => setView(candidate.id)}
                className={cn(
                  'h-8 rounded-md px-4 text-sm',
                  view === candidate.id
                    ? 'bg-primary-600 font-medium text-white'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {candidate.label}
              </button>
            ))}
          </div>
          <div role="tabpanel">
            {view === 'comments' && <CommentsTab ideaId={ideaId} version={dataVersion} />}
            {view === 'dm' && (
              <DmTab
                ideaId={ideaId}
                version={dataVersion}
                dmCollected={status.summary?.dmCollected ?? false}
              />
            )}
            {view === 'runs' && <RunsTab ideaId={ideaId} version={dataVersion} running={running} />}
          </div>
        </div>
      )}
    </div>
  );
}

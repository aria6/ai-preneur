import {
  BANK_IDEA_LABEL_TEXT,
  BANK_IDEA_MARKET_SCOPE_LABELS,
  PERMISSIONS,
  updateBankIdeaRequestSchema,
  type BankIdeaDetailResponse,
  type BankIdeaRunDto,
} from '@ai-preneur/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Button } from '../../components/ui/Button';
import { Alert, Badge, Card, EmptyState } from '../../components/ui/feedback';
import { Icon } from '../../components/ui/Icon';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useAuth } from '../../hooks/use-auth';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import * as bankIdeaService from '../../services/bank-idea.service';
import {
  ActiveRunBadge,
  formatDuration,
  IdeaFields,
  StageBadge,
  type IdeaFormValues,
} from './bank-idea-ui';
import {
  CompetitorsPanel,
  CriteriaPanel,
  ResearchSummary,
  TargetSegmentsPanel,
} from './research-result';

const POLL_MS = 5_000;

type Panel = 'target' | 'criteria' | 'competitors' | 'idea';
const PANEL_TITLES: Record<Panel, string> = {
  target: 'Target pasar potensial',
  criteria: 'Detail penilaian',
  competitors: 'Kompetitor',
  idea: 'Isi ide',
};

const RUN_STATUS_TEXT: Record<BankIdeaRunDto['status'], string> = {
  queued: 'Antre',
  running: 'Berjalan',
  succeeded: 'Selesai',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
};

const BackLink = () => (
  <Link
    to="/bank-idea"
    className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
  >
    <Icon name="chevronLeft" className="size-4" /> Bank Idea
  </Link>
);

function useElapsed(since: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? formatDuration(Math.max(0, now - new Date(since).getTime())) : null;
}

function EditIdeaModal({
  detail,
  onClose,
  onSaved,
}: {
  detail: BankIdeaDetailResponse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { idea } = detail;
  const [values, setValues] = useState<IdeaFormValues>({
    title: idea.title,
    summary: idea.summary,
    problem: idea.problem,
    solution: idea.solution,
    marketScope: idea.marketScope,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const parsed = updateBankIdeaRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await bankIdeaService.updateIdea(idea.id, parsed.data);
      onSaved();
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      size="lg"
      title="Ubah ide"
      description="Perubahan isi membuat hasil riset terakhir ditandai “berubah sejak riset”."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="edit-idea-form" loading={saving}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="edit-idea-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <IdeaFields values={values} onChange={setValues} errors={errors} />
      </form>
    </Modal>
  );
}

export function BankIdeaDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.BANK_IDEA_MANAGE);
  const canResearch = can(PERMISSIONS.BANK_IDEA_RESEARCH);

  const [detail, setDetail] = useState<BankIdeaDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);

  /** Opens a detail modal; for "Detail penilaian" it can scroll to one dimension. */
  const openPanel = (next: Panel, dimensionKey?: string) => {
    setPanel(next);
    if (dimensionKey) {
      requestAnimationFrame(() =>
        document.getElementById(`dimensi-${dimensionKey}`)?.scrollIntoView({ block: 'start' }),
      );
    }
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await bankIdeaService.getIdea(id, signal);
        setDetail(next);
        setLoadError(null);
      } catch (error) {
        if (!signal?.aborted) setLoadError(errorMessage(error));
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    bankIdeaService
      .getIdea(id, controller.signal)
      .then((next) => {
        setDetail(next);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      });
    return () => controller.abort();
  }, [id]);

  const activeRun = detail?.idea.activeRun ?? null;

  // While a research is queued/running: poll its status, reload the page when it ends.
  useEffect(() => {
    if (!activeRun) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      bankIdeaService
        .getResearchStatus(id, controller.signal)
        .then((status) => {
          if (status.activeRun?.id !== activeRun.id) {
            setSelectedRunId(null);
            void reload();
          } else if (
            status.activeRun.status !== activeRun.status ||
            status.activeRun.queuePosition !== activeRun.queuePosition
          ) {
            setDetail((current) =>
              current
                ? { ...current, idea: { ...current.idea, activeRun: status.activeRun } }
                : current,
            );
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [id, activeRun, reload]);

  const elapsed = useElapsed(activeRun?.status === 'running' ? activeRun.startedAt : null);

  const act = async (key: string, action: () => Promise<unknown>) => {
    setActionError(null);
    setBusy(key);
    try {
      await action();
      await reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  if (loadError && !detail) {
    return (
      <>
        <BackLink />
        <Alert>{loadError}</Alert>
      </>
    );
  }
  if (!detail) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Spinner className="size-7" />
      </div>
    );
  }

  const { idea, runs } = detail;
  const archived = idea.archivedAt !== null;
  const succeeded = runs.filter((run) => run.status === 'succeeded' && run.result);
  const selectedRun =
    (selectedRunId ? runs.find((run) => run.id === selectedRunId) : undefined) ?? succeeded[0];
  const lastRun = runs[0];
  const isLatestSucceeded = selectedRun?.id === succeeded[0]?.id;
  const result = selectedRun?.result ?? null;
  const noResult = 'Belum ada hasil riset';
  const navItems: { key: Panel; label: string; meta: string; disabled: boolean }[] = [
    {
      key: 'target',
      label: 'Target pasar potensial',
      meta: result?.targetSegments?.length
        ? `${result.targetSegments.length} segmen`
        : result
          ? 'Tidak ada di riset ini'
          : noResult,
      disabled: !result?.targetSegments?.length,
    },
    {
      key: 'criteria',
      label: 'Detail penilaian',
      meta: result ? '9 sub-poin, alasan & sumber' : noResult,
      disabled: !result,
    },
    {
      key: 'competitors',
      label: 'Kompetitor',
      meta: result ? `${result.competitors.length} ditemukan` : noResult,
      disabled: !result,
    },
    {
      key: 'idea',
      label: 'Isi ide',
      meta: 'Ringkasan, masalah, solusi, ide mentah',
      disabled: false,
    },
  ];

  return (
    <>
      <BackLink />

      <div className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              {idea.title}
            </h1>
            <StageBadge stage={idea.stage} archived={archived} />
            {activeRun && <ActiveRunBadge run={activeRun} />}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Pasar {BANK_IDEA_MARKET_SCOPE_LABELS[idea.marketScope]} · Dibuat{' '}
            {formatDateTime(idea.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 xl:shrink-0 xl:justify-end">
          {canResearch && !archived && !activeRun && (
            <Button
              onClick={() => void act('research', () => bankIdeaService.startResearch(idea.id))}
              loading={busy === 'research'}
              disabled={busy !== null}
            >
              <Icon name={succeeded.length > 0 ? 'refresh' : 'search'} className="size-4" />
              {succeeded.length > 0 ? 'Riset ulang' : 'Riset sekarang'}
            </Button>
          )}
          {canManage && !archived && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy !== null}>
                <Icon name="edit" className="size-4" /> Ubah
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void act('executed', () =>
                    bankIdeaService.updateIdea(idea.id, { executed: idea.stage !== 'executed' }),
                  )
                }
                loading={busy === 'executed'}
                disabled={busy !== null}
              >
                <Icon name="check" className="size-4" />
                {idea.stage === 'executed' ? 'Batal dieksekusi' : 'Tandai dieksekusi'}
              </Button>
            </>
          )}
          {canManage && (
            <Button
              variant="secondary"
              onClick={() =>
                void act('archive', () => bankIdeaService.setArchived(idea.id, !archived))
              }
              loading={busy === 'archive'}
              disabled={busy !== null || (!archived && activeRun !== null)}
            >
              <Icon name="folder" className="size-4" /> {archived ? 'Pulihkan' : 'Arsipkan'}
            </Button>
          )}
          {canManage && (
            <Button
              variant="dangerGhost"
              onClick={() => {
                setDeleteError(null);
                setConfirmDelete(true);
              }}
              disabled={busy !== null || activeRun !== null}
            >
              <Icon name="trash" className="size-4" /> Hapus permanen
            </Button>
          )}
        </div>
      </div>

      {actionError && <Alert className="mb-4">{actionError}</Alert>}
      {archived && (
        <Alert variant="info" className="mb-4">
          Ide ini diarsip: tidak bisa diubah atau diriset sampai dipulihkan.
        </Alert>
      )}

      {activeRun && (
        <Card className="mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Spinner className="size-5 text-sky-600" />
            <div>
              <p className="text-sm font-medium text-slate-900">
                {activeRun.status === 'running'
                  ? `AI sedang meriset ide ini${elapsed ? ` · ${elapsed}` : ''}`
                  : `Menunggu giliran riset (antrean ke-${activeRun.queuePosition})`}
              </p>
              <p className="text-xs text-slate-500">
                Riset biasanya 2–10 menit. Halaman ini diperbarui otomatis; boleh ditinggal.
              </p>
            </div>
          </div>
          {canResearch && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void act('cancel', () => bankIdeaService.cancelResearch(idea.id, activeRun.id))
              }
              loading={busy === 'cancel'}
              disabled={busy !== null}
            >
              Batalkan riset
            </Button>
          )}
        </Card>
      )}

      {lastRun?.status === 'failed' && !activeRun && (
        <Alert className="mb-6">
          Riset terakhir (versi {lastRun.version}) gagal:{' '}
          {lastRun.errorMessage ?? 'tidak diketahui'}
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {selectedRun?.result ? (
            <ResearchSummary
              run={selectedRun}
              result={selectedRun.result}
              outdated={isLatestSucceeded && idea.changedSinceResearch}
              onOpenDimension={(key) => openPanel('criteria', key)}
            />
          ) : (
            <EmptyState
              icon="lightbulb"
              title="Belum ada hasil riset"
              description={
                activeRun
                  ? 'Hasil riset muncul di sini setelah selesai.'
                  : 'Jalankan riset untuk mendapatkan skor tren, ukuran pasar, kompetisi, dan monetisasi beserta alasannya.'
              }
            />
          )}
        </div>

        <aside className="space-y-4">
          <Card className="p-2">
            <h2 className="px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
              Lihat detail
            </h2>
            <nav className="flex flex-col">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => openPanel(item.key)}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span>
                    <span className="block font-medium text-slate-800">{item.label}</span>
                    <span className="block text-xs text-slate-500">{item.meta}</span>
                  </span>
                  <Icon name="chevronRight" className="size-4 shrink-0 text-slate-400" />
                </button>
              ))}
            </nav>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-slate-900">Riwayat riset</h2>
            {runs.length === 0 ? (
              <p className="text-sm text-slate-400">Belum pernah diriset.</p>
            ) : (
              <ul className="space-y-1">
                {runs.map((run) => {
                  const viewable = run.status === 'succeeded' && run.result !== null;
                  const selected = run.id === selectedRun?.id;
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        disabled={!viewable}
                        onClick={() => setSelectedRunId(run.id)}
                        aria-pressed={selected}
                        className={
                          'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm ' +
                          (selected
                            ? 'bg-primary-50 text-primary-800'
                            : viewable
                              ? 'hover:bg-slate-50'
                              : 'cursor-default text-slate-500')
                        }
                        title={run.errorMessage ?? undefined}
                      >
                        <span>
                          <span className="font-medium">v{run.version}</span>{' '}
                          <span className="text-xs text-slate-500">
                            {formatDateTime(run.finishedAt ?? run.createdAt)}
                          </span>
                        </span>
                        {viewable && run.totalScore !== null && run.label ? (
                          <span className="text-xs font-semibold tabular-nums">
                            {run.totalScore} · {BANK_IDEA_LABEL_TEXT[run.label]}
                          </span>
                        ) : (
                          <Badge color={run.status === 'failed' ? 'red' : 'gray'}>
                            {RUN_STATUS_TEXT[run.status]}
                          </Badge>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      {editing && (
        <EditIdeaModal
          detail={detail}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}

      <Modal
        open={panel !== null}
        onClose={() => setPanel(null)}
        size={panel === 'criteria' ? 'xl' : 'lg'}
        title={panel ? PANEL_TITLES[panel] : ''}
        description={
          panel && panel !== 'idea' && selectedRun
            ? `Riset versi ${selectedRun.version}`
            : undefined
        }
      >
        {panel === 'target' && result?.targetSegments && (
          <TargetSegmentsPanel segments={result.targetSegments} />
        )}
        {panel === 'criteria' && result && <CriteriaPanel result={result} />}
        {panel === 'competitors' && result && <CompetitorsPanel result={result} />}
        {panel === 'idea' && (
          <>
            <dl className="space-y-4 text-sm">
              {[
                ['Ringkasan', idea.summary],
                ['Masalah', idea.problem],
                ['Solusi', idea.solution],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="whitespace-pre-line text-slate-700">{value || '—'}</dd>
                </div>
              ))}
            </dl>
            {idea.rawInput && (
              <div className="mt-4 border-t border-slate-100 pt-4 text-sm">
                <p className="text-xs text-slate-500">Ide mentah</p>
                <p className="mt-1 whitespace-pre-line text-slate-600">{idea.rawInput}</p>
              </div>
            )}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Hapus ide permanen?"
        message={
          <>
            <strong>{idea.title}</strong> dan seluruh riwayat risetnya akan dihapus dan tidak bisa
            dikembalikan. Kalau hanya ingin menyembunyikannya, pakai Arsipkan.
          </>
        }
        confirmLabel="Hapus permanen"
        loading={busy === 'delete'}
        error={deleteError}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setBusy('delete');
          setDeleteError(null);
          bankIdeaService
            .deleteIdea(idea.id)
            .then(() => navigate('/bank-idea', { replace: true }))
            .catch((error: unknown) => {
              setDeleteError(errorMessage(error));
              setBusy(null);
            });
        }}
      />
    </>
  );
}

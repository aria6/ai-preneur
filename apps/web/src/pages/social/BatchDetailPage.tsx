import { PERMISSIONS, type BatchDetailDto } from '@ai-preneur/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Button } from '../../components/ui/Button';
import { Alert, PageHeader } from '../../components/ui/feedback';
import { Icon } from '../../components/ui/Icon';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useAuth } from '../../hooks/use-auth';
import { formatSchedule } from '../../lib/datetime';
import { errorDetails, errorMessage } from '../../lib/errors';
import * as socialService from '../../services/social.service';
import { BatchStatusBadge } from './components/BatchStatusBadge';
import { IdeaCard } from './components/IdeaCard';
import { PlatformsCard } from './components/PlatformsCard';
import { QueueSection } from './components/QueueSection';

const REFRESH_MS = 60_000;
const PROGRESS_REFRESH_MS = 3_000;

type PendingAction = 'confirm' | 'cancel' | 'delete' | 'archive' | 'unarchive' | null;

export function BatchDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.SOCIAL_PUBLISHER_MANAGE);

  const [batch, setBatch] = useState<BatchDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ message: string; details: string[] } | null>(
    null,
  );
  const [pending, setPending] = useState<PendingAction>(null);
  const [dialog, setDialog] = useState<PendingAction>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(
    (signal?: AbortSignal) =>
      socialService
        .getBatch(id, signal)
        .then((next) => {
          setBatch(next);
          setNow(new Date());
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) setLoadError(errorMessage(error));
        }),
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Locks depend on time: refresh while uploads are scheduled — every few seconds
  // while an upload runs, so its progress shows up live.
  const uploading =
    batch?.items.some((item) =>
      item.publications.some((p) => p.status === 'queued' || p.status === 'processing'),
    ) ?? false;
  useEffect(() => {
    if (!uploading && batch?.status !== 'scheduled') return;
    const timer = window.setInterval(
      () => void load(),
      uploading ? PROGRESS_REFRESH_MS : REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, [batch?.status, uploading, load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const onChange = useCallback((next: BatchDetailDto) => {
    setBatch(next);
    setNow(new Date());
    setActionError(null);
  }, []);

  const runAction = async (action: Exclude<PendingAction, null>) => {
    if (!batch) return;
    setPending(action);
    setActionError(null);
    try {
      if (action === 'delete') {
        await socialService.deleteBatch(batch.id);
        navigate('/social/publisher', { replace: true });
        return;
      }
      const actions = {
        confirm: {
          run: socialService.confirmBatch,
          notice: 'Jadwal dikonfirmasi. Video akan diunggah otomatis sesuai jadwal masing-masing.',
        },
        cancel: {
          run: socialService.cancelBatchSchedule,
          notice: 'Jadwal dibatalkan. Batch kembali ke Draft.',
        },
        archive: {
          run: socialService.archiveBatch,
          notice: 'Ide diarsip. Lihat lagi lewat filter Arsip di daftar ide.',
        },
        unarchive: {
          run: socialService.unarchiveBatch,
          notice: 'Arsip dibuka. Ide kembali ke daftar Aktif.',
        },
      } as const;
      onChange(await actions[action].run(batch.id));
      setNotice(actions[action].notice);
    } catch (error) {
      setActionError({ message: errorMessage(error), details: errorDetails(error) });
    } finally {
      setPending(null);
      setDialog(null);
    }
  };

  if (loadError && !batch) {
    return (
      <div className="space-y-4">
        <Link
          to="/social/publisher"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <Icon name="chevronLeft" className="size-4" /> Publisher AIgent
        </Link>
        <Alert>{loadError}</Alert>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Spinner className="size-7" />
      </div>
    );
  }

  const archived = batch.archivedAt !== null;
  const isDraft = batch.status === 'draft' && !archived;
  const isScheduled = batch.status === 'scheduled';
  const isCompleted = batch.status === 'completed' && !archived;
  const hasPublished = batch.publishedCount > 0;

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link
          to="/social/publisher"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <Icon name="chevronLeft" className="size-4" /> Publisher AIgent
        </Link>
        <BatchStatusBadge status={batch.status} archived={archived} />
      </div>

      <PageHeader
        title={batch.title}
        description={`IDEA_ID ${batch.ideaNumber} · ${batch.items.length} video${
          batch.confirmedAt ? ` · dikonfirmasi ${formatSchedule(batch.confirmedAt)}` : ''
        }`}
        actions={
          <>
            {canManage && archived && (
              <Button
                variant="secondary"
                onClick={() => void runAction('unarchive')}
                loading={pending === 'unarchive'}
                disabled={pending !== null && pending !== 'unarchive'}
              >
                Buka arsip
              </Button>
            )}
            {canManage && (isDraft || isCompleted) && (
              <Button
                variant="secondary"
                onClick={() => setDialog('archive')}
                disabled={pending !== null}
              >
                Arsipkan
              </Button>
            )}
            {canManage && isDraft && (
              <>
                <Button
                  variant="dangerGhost"
                  onClick={() => setDialog('delete')}
                  disabled={pending !== null}
                >
                  <Icon name="trash" className="size-4" /> Hapus batch
                </Button>
                <Button onClick={() => void runAction('confirm')} loading={pending === 'confirm'}>
                  <Icon name="check" className="size-4" /> Konfirmasi jadwal
                </Button>
              </>
            )}
            {canManage && isScheduled && (
              <Button
                variant="secondary"
                onClick={() => setDialog('cancel')}
                disabled={pending !== null}
              >
                Batalkan jadwal
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {notice && <Alert variant="success">{notice}</Alert>}
        {actionError && (
          <Alert>
            <p className="font-medium">{actionError.message}</p>
            {actionError.details.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {actionError.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        {archived && (
          <Alert variant="info">
            <strong>Arsip</strong> — ide ini hanya bisa dilihat; tidak ada yang diunggah. Klik{' '}
            <strong>Buka arsip</strong> untuk mengubahnya lagi.
          </Alert>
        )}
        {isDraft && (
          <Alert variant="info">
            <strong>Draft</strong> —{' '}
            {hasPublished
              ? 'video yang sudah terunggah tetap tercatat dan tidak diunggah ulang.'
              : 'belum ada yang diunggah.'}{' '}
            Lengkapi antrean, pilih media sosial dan hubungkan akunnya, lalu klik{' '}
            <strong>Konfirmasi jadwal</strong>. Konten pertama harus dijadwalkan minimal{' '}
            {batch.settings.minConfirmLeadMinutes} menit dari saat konfirmasi.
          </Alert>
        )}
        {isCompleted && (
          <Alert variant="info">
            <strong>Selesai</strong> — semua video sudah terunggah. Ide ini masih bisa ditambah
            video (Generate antrean konten atau tambah baris) dan akunnya masih bisa diganti; setiap
            perubahan mengembalikan ide ke <strong>Draft</strong> dan perlu{' '}
            <strong>Konfirmasi jadwal</strong> lagi. Video yang sudah terunggah tidak berubah.
          </Alert>
        )}
        {isScheduled && (
          <Alert variant="info">
            <strong>Terjadwal</strong> — setiap video diunggah otomatis pada jadwalnya. Baris masih
            bisa diubah, diurutkan, ditunda, atau dihapus sampai {batch.settings.lockMinutes} menit
            sebelum jadwalnya.
          </Alert>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <IdeaCard batch={batch} canManage={canManage} onChange={onChange} onNotice={setNotice} />
          <PlatformsCard
            batch={batch}
            canManage={canManage}
            onChange={onChange}
            onNotice={setNotice}
          />
        </div>

        <QueueSection
          batch={batch}
          canManage={canManage}
          now={now}
          onChange={onChange}
          onNotice={setNotice}
        />
      </div>

      <ConfirmDialog
        open={dialog === 'cancel'}
        title="Batalkan jadwal?"
        message="Batch kembali ke Draft dan unggahan yang belum berjalan dihentikan. Video yang sudah terunggah tetap tercatat."
        confirmLabel="Batalkan jadwal"
        loading={pending === 'cancel'}
        onConfirm={() => void runAction('cancel')}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'archive'}
        title="Arsipkan ide?"
        message={
          <>
            <strong>{batch.title}</strong> pindah ke filter Arsip dan tidak bisa diubah atau
            diunggah sampai arsipnya dibuka. Data dan akun yang terhubung tetap tersimpan.
          </>
        }
        confirmLabel="Arsipkan"
        loading={pending === 'archive'}
        onConfirm={() => void runAction('archive')}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        title="Hapus batch?"
        message={
          <>
            Batch <strong>{batch.title}</strong> beserta antreannya dan akun yang terhubung akan
            dihapus permanen.
          </>
        }
        loading={pending === 'delete'}
        onConfirm={() => void runAction('delete')}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

import {
  PUBLISH_STAGE_LABELS,
  PUBLISH_STAGES,
  SOCIAL_PLATFORM_LABELS,
  type BatchDetailDto,
  type SocialPlatform,
} from '@ai-preneur/shared';
import { useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Alert } from '../../../components/ui/feedback';
import { Icon } from '../../../components/ui/Icon';
import { Modal } from '../../../components/ui/Modal';
import { Spinner } from '../../../components/ui/Spinner';
import { cn } from '../../../lib/cn';
import { formatSchedule } from '../../../lib/datetime';
import { errorMessage } from '../../../lib/errors';
import * as socialService from '../../../services/social.service';

export interface PublishTarget {
  itemId: string;
  platform: SocialPlatform;
}

/**
 * One dialog for a row on a platform, driven by live batch data (the page polls
 * while an upload runs):
 * - not uploaded → "Unggah sekarang?" confirmation (title only)
 * - queued / processing → step-by-step progress
 * - published → success (or the caveat) with the link
 * - failed → the error, retry info and "Unggah sekarang" when allowed
 */
export function PublishDialog({
  batch,
  target,
  canManage,
  onChange,
  onClose,
}: {
  batch: BatchDetailDto;
  target: PublishTarget | null;
  canManage: boolean;
  onChange: (batch: BatchDetailDto) => void;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Opened via "Unggah sekarang" in this dialog: show the outcome as a result. */
  const [started, setStarted] = useState(false);

  const item = target ? batch.items.find((entry) => entry.id === target.itemId) : undefined;
  const publication = item?.publications.find((p) => p.platform === target?.platform) ?? null;
  const option = item?.uploadOptions.find((o) => o.platform === target?.platform);
  const label = target ? SOCIAL_PLATFORM_LABELS[target.platform] : '';
  const canUpload = canManage && option?.blockedReason === null;

  const close = () => {
    setError(null);
    setStarted(false);
    onClose();
  };

  const upload = async () => {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      onChange(await socialService.publishNow(batch.id, target.itemId, target.platform));
      setStarted(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const open = target !== null && item !== undefined;
  const closeButton = (
    <Button variant="secondary" onClick={close} disabled={submitting}>
      Tutup
    </Button>
  );
  const uploadButton = (text: string) => (
    <Button onClick={() => void upload()} loading={submitting}>
      <Icon name="play" className="size-4" />
      {text}
    </Button>
  );

  // In progress.
  if (publication?.status === 'queued' || publication?.status === 'processing') {
    return (
      <Modal
        open={open}
        onClose={close}
        title={`Mengunggah ke ${label}`}
        description={item?.title}
        footer={closeButton}
      >
        <ProgressSteps
          stage={publication.progressStage ?? 'queued'}
          percent={publication.progressPercent}
        />
        <p className="mt-4 text-xs text-slate-500">
          Dialog ini boleh ditutup; unggahan tetap berjalan dan statusnya terlihat di baris.
        </p>
      </Modal>
    );
  }

  // Done.
  if (publication?.status === 'published') {
    const link = publication.externalUrl;
    return (
      <Modal
        open={open}
        onClose={close}
        title={
          publication.warningMessage && !started
            ? `Terunggah ke ${label} dengan catatan`
            : `Berhasil diunggah ke ${label}`
        }
        description={item?.title}
        footer={
          <>
            {closeButton}
            {link && (
              <Button onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}>
                <Icon name="external" className="size-4" /> Buka video
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          {started && <Alert variant="success">Video sudah tayang di {label}.</Alert>}
          {publication.warningMessage && (
            <Alert variant="warning">{publication.warningMessage}</Alert>
          )}
        </div>
      </Modal>
    );
  }

  // Failed.
  if (publication?.status === 'failed') {
    return (
      <Modal
        open={open}
        onClose={close}
        busy={submitting}
        title={`Gagal diunggah ke ${label}`}
        footer={
          <>
            {closeButton}
            {canUpload && uploadButton('Unggah sekarang')}
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <ItemTitle title={item?.title} />
          <Alert>{publication.errorMessage ?? 'Terjadi kesalahan saat mengunggah.'}</Alert>
          <p className="text-slate-600">
            Percobaan ke-{publication.attempts}.{' '}
            {publication.nextAttemptAt
              ? `Akan diunggah otomatis ${formatSchedule(publication.nextAttemptAt)}.`
              : 'Tidak diunggah ulang otomatis.'}
          </p>
          {canManage && option?.blockedReason && (
            <p className="text-slate-600">{option.blockedReason}</p>
          )}
          {error && <Alert>{error}</Alert>}
        </div>
      </Modal>
    );
  }

  // Not uploaded yet: confirmation.
  return (
    <Modal
      open={open}
      onClose={close}
      busy={submitting}
      title={`Unggah ke ${label} sekarang?`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Batal
          </Button>
          {canUpload && uploadButton('Unggah sekarang')}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <ItemTitle title={item?.title} />
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}

/** "Judul : …" line naming the row in the upload dialogs. */
function ItemTitle({ title }: { title: string | undefined }) {
  if (!title) return null;
  return (
    <p className="text-slate-500">
      Judul : <span className="font-medium break-words text-slate-900">{title}</span>
    </p>
  );
}

function ProgressSteps({
  stage,
  percent,
}: {
  stage: (typeof PUBLISH_STAGES)[number];
  percent: number | null;
}) {
  const current = PUBLISH_STAGES.indexOf(stage);
  return (
    <ol className="space-y-2.5">
      {PUBLISH_STAGES.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full',
                done && 'bg-emerald-100 text-emerald-700',
                active && 'bg-primary-100 text-primary-700',
                !done && !active && 'bg-slate-100 text-slate-400',
              )}
            >
              {done ? (
                <Icon name="check" className="size-3.5" />
              ) : active ? (
                <Spinner className="size-3.5" />
              ) : (
                <span className="text-xs">{index + 1}</span>
              )}
            </span>
            <span className={cn(active ? 'font-medium text-slate-900' : 'text-slate-500')}>
              {PUBLISH_STAGE_LABELS[step]}
              {active && percent !== null && ` — ${percent}%`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

import {
  BATCH_DESCRIPTION_MAX_LENGTH,
  BATCH_TITLE_MAX_LENGTH,
  createBatchRequestSchema,
  PERMISSIONS,
  type BatchSummaryDto,
} from '@ai-preneur/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { Button } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/fields';
import { Alert, EmptyState, PageHeader } from '../../components/ui/feedback';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useAuth } from '../../hooks/use-auth';
import { formatSchedule } from '../../lib/datetime';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../../lib/errors';
import * as socialService from '../../services/social.service';
import { BatchStatusBadge } from './components/BatchStatusBadge';
import { PlatformTag } from './components/PlatformChip';

function CreateBatchModalContent({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [driveFolderUrl, setDriveFolderUrl] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const parsed = createBatchRequestSchema.safeParse({
      title,
      description,
      driveFolderUrl,
      platforms: [],
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const batch = await socialService.createBatch(parsed.data);
      navigate(`/social/publisher/${batch.id}`);
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title="Buat batch publikasi"
      description="Satu batch untuk satu ide. Antrean konten digenerate dari folder Google Drive."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="create-batch-form" loading={saving}>
            Buat batch
          </Button>
        </>
      }
    >
      <form id="create-batch-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField
          label="Judul ide"
          data-autofocus
          placeholder="Contoh: Seri edukasi akuaponik"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          error={errors.title}
          maxLength={BATCH_TITLE_MAX_LENGTH}
        />
        <TextAreaField
          label="Deskripsi ide (opsional)"
          rows={4}
          placeholder="Contoh: Seri video pendek untuk pemula tentang cara memulai akuaponik di rumah — target audiens, gaya penyampaian, tujuan seri."
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={errors.description}
          maxLength={BATCH_DESCRIPTION_MAX_LENGTH}
          hint={`${description.length.toLocaleString('id-ID')}/${BATCH_DESCRIPTION_MAX_LENGTH.toLocaleString('id-ID')} karakter`}
        />
        <TextField
          label="Link folder Google Drive"
          type="url"
          inputMode="url"
          placeholder="https://drive.google.com/drive/folders/…"
          value={driveFolderUrl}
          onChange={(event) => setDriveFolderUrl(event.target.value)}
          error={errors.driveFolderUrl}
          hint='Akses folder harus "Siapa saja yang memiliki link". Video di folder utama, thumbnail di subfolder thumbnail/, caption (.txt) di subfolder caption/.'
        />
      </form>
    </Modal>
  );
}

function BatchCard({ batch }: { batch: BatchSummaryDto }) {
  return (
    <Link
      to={`/social/publisher/${batch.id}`}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition-colors hover:border-primary-300 focus-visible:outline-2 focus-visible:outline-primary-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">IDEA_ID {batch.ideaNumber}</p>
          <h2 className="mt-0.5 truncate font-semibold text-slate-900 group-hover:text-primary-700">
            {batch.title}
          </h2>
          {batch.description && (
            <p className="mt-1 line-clamp-2 text-sm whitespace-pre-line text-slate-500">
              {batch.description}
            </p>
          )}
        </div>
        <BatchStatusBadge status={batch.status} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {batch.platforms.length === 0 ? (
          <span className="text-xs text-slate-400">Belum memilih media sosial</span>
        ) : (
          batch.platforms.map((platform) => <PlatformTag key={platform} platform={platform} />)
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Video</dt>
          <dd className="font-medium text-slate-900">
            {batch.itemCount}{' '}
            <span className="font-normal text-slate-500">· {batch.publishedCount} terunggah</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Unggahan berikutnya</dt>
          <dd className="font-medium text-slate-900">{formatSchedule(batch.nextScheduledAt)}</dd>
        </div>
      </dl>
    </Link>
  );
}

export function PublisherListPage() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.SOCIAL_PUBLISHER_MANAGE);
  const [batches, setBatches] = useState<BatchSummaryDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    socialService
      .listBatches(controller.signal)
      .then(setBatches)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <PageHeader
        title="Publisher AIgent"
        description="Susun antrean video dari Google Drive, jadwalkan, lalu unggah otomatis ke media sosial."
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <Icon name="plus" className="size-4" /> Buat batch
            </Button>
          )
        }
      />

      {loadError ? (
        <Alert>{loadError}</Alert>
      ) : batches === null ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="size-7" />
        </div>
      ) : batches.length === 0 ? (
        <EmptyState
          icon="megaphone"
          title="Belum ada batch publikasi"
          description="Buat batch untuk sebuah ide, tempel link folder Google Drive, lalu generate antrean kontennya."
          action={
            canManage && (
              <Button onClick={() => setCreating(true)}>
                <Icon name="plus" className="size-4" /> Buat batch
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {batches.map((batch) => (
            <BatchCard key={batch.id} batch={batch} />
          ))}
        </div>
      )}

      <CreateBatchModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/** Mounted only while open, so every opening starts from fresh form state (no reset effect). */
function CreateBatchModal(props: Parameters<typeof CreateBatchModalContent>[0]) {
  return props.open ? <CreateBatchModalContent key={'create'} {...props} /> : null;
}

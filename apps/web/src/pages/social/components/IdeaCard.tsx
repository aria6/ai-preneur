import {
  updateBatchRequestSchema,
  type BatchDetailDto,
  type ScanWarning,
  type UpdateBatchRequest,
} from '@ai-preneur/shared';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../../components/ui/Button';
import { TextField } from '../../../components/ui/fields';
import { Alert, Card } from '../../../components/ui/feedback';
import { Icon } from '../../../components/ui/Icon';
import { ConfirmDialog } from '../../../components/ui/Modal';
import {
  apiFieldErrors,
  errorMessage,
  zodFieldErrors,
  type FieldErrors,
} from '../../../lib/errors';
import * as socialService from '../../../services/social.service';

const MAX_WARNINGS_SHOWN = 8;

export function IdeaCard({
  batch,
  canManage,
  onChange,
  onNotice,
}: {
  batch: BatchDetailDto;
  canManage: boolean;
  onChange: (batch: BatchDetailDto) => void;
  onNotice: (message: string) => void;
}) {
  const [title, setTitle] = useState(batch.title);
  const [ideaNumber, setIdeaNumber] = useState(String(batch.ideaNumber));
  const [folderUrl, setFolderUrl] = useState(batch.driveFolderUrl);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [confirmRescan, setConfirmRescan] = useState(false);
  const [report, setReport] = useState<{ added: number; warnings: ScanWarning[] } | null>(null);

  useEffect(() => {
    setTitle(batch.title);
    setIdeaNumber(String(batch.ideaNumber));
    setFolderUrl(batch.driveFolderUrl);
  }, [batch.title, batch.ideaNumber, batch.driveFolderUrl]);

  const isDraft = batch.status === 'draft';
  const editable = canManage && batch.status !== 'completed';
  const dirty =
    title !== batch.title ||
    ideaNumber !== String(batch.ideaNumber) ||
    folderUrl.trim() !== batch.driveFolderUrl;

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const patch: UpdateBatchRequest = {};
    if (title !== batch.title) patch.title = title;
    if (ideaNumber !== String(batch.ideaNumber))
      patch.ideaNumber = ideaNumber.trim() === '' ? Number.NaN : Number(ideaNumber);
    if (folderUrl.trim() !== batch.driveFolderUrl) patch.driveFolderUrl = folderUrl;

    const parsed = updateBatchRequestSchema.safeParse(patch);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      onChange(await socialService.updateBatch(batch.id, parsed.data));
      onNotice('Informasi ide disimpan.');
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const scan = async () => {
    setConfirmRescan(false);
    setFormError(null);
    setReport(null);
    setScanning(true);
    try {
      const result = await socialService.scanBatch(batch.id);
      onChange(result.batch);
      setReport(result.report);
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card>
      <form onSubmit={onSave} noValidate>
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold">Ide & sumber konten</h2>
          <p className="text-sm text-slate-500">
            Video diambil dari folder Google Drive berdasarkan nama file.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          {formError && <Alert>{formError}</Alert>}
          {report && (
            <Alert variant={report.warnings.length > 0 ? 'info' : 'success'}>
              <p className="font-medium">{report.added} video ditambahkan ke antrean.</p>
              {report.warnings.length > 0 && (
                <>
                  <p className="mt-1">Perlu diperhatikan:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {report.warnings.slice(0, MAX_WARNINGS_SHOWN).map((warning, index) => (
                      <li key={`${warning.fileName}-${index}`}>
                        <span className="font-mono text-xs">{warning.fileName}</span> —{' '}
                        {warning.message}
                      </li>
                    ))}
                  </ul>
                  {report.warnings.length > MAX_WARNINGS_SHOWN && (
                    <p className="mt-1">
                      …dan {report.warnings.length - MAX_WARNINGS_SHOWN} catatan lainnya.
                    </p>
                  )}
                </>
              )}
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <TextField
              label="Ide"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              error={errors.title}
              maxLength={200}
              disabled={!editable}
            />
            <TextField
              label="IDEA_ID"
              type="number"
              min={0}
              inputMode="numeric"
              value={ideaNumber}
              onChange={(event) => setIdeaNumber(event.target.value)}
              error={errors.ideaNumber}
              disabled={!editable || !isDraft}
            />
          </div>
          <TextField
            label="Link folder Google Drive"
            type="url"
            inputMode="url"
            value={folderUrl}
            onChange={(event) => setFolderUrl(event.target.value)}
            error={errors.driveFolderUrl}
            disabled={!editable || !isDraft}
            hint={
              isDraft
                ? 'Struktur: video di folder utama (mis. 2.1-apa-akuaponik.mp4), thumbnail bernama sama di subfolder thumbnail/.'
                : 'Link folder dan IDEA_ID hanya bisa diubah saat Draft.'
            }
          />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <a
            href={batch.driveFolderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            <Icon name="folder" className="size-4" /> Buka folder
          </a>
          {editable && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {isDraft && (
                <Button
                  variant="secondary"
                  onClick={() => (batch.items.length > 0 ? setConfirmRescan(true) : void scan())}
                  loading={scanning}
                  disabled={saving || dirty}
                  title={dirty ? 'Simpan perubahan terlebih dahulu' : undefined}
                >
                  <Icon name="refresh" className="size-4" /> Generate antrean konten
                </Button>
              )}
              <Button type="submit" loading={saving} disabled={!dirty || scanning}>
                Simpan
              </Button>
            </div>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmRescan}
        title="Generate ulang antrean?"
        message="Antrean yang ada (termasuk caption, hashtag, dan jadwal yang sudah diisi) akan diganti dengan hasil baca ulang folder Google Drive."
        confirmLabel="Generate ulang"
        onConfirm={() => void scan()}
        onClose={() => setConfirmRescan(false)}
      />
    </Card>
  );
}

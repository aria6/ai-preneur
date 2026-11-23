import {
  autoScheduleRequestSchema,
  SCHEDULE_INTERVAL_OPTIONS,
  type BatchDetailDto,
  type QueueItemDto,
} from '@ai-preneur/shared';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../../components/ui/Button';
import { SelectField, TextField } from '../../../components/ui/fields';
import { Alert } from '../../../components/ui/feedback';
import { Modal } from '../../../components/ui/Modal';
import { fromDateTimeLocal, suggestStart, toDateTimeLocal } from '../../../lib/datetime';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../../../lib/errors';
import * as socialService from '../../../services/social.service';

/** "Jadwalkan semua": fills the schedule of every editable, active row in queue order. */
export function AutoScheduleModal({
  open,
  batch,
  onClose,
  onSaved,
}: {
  open: boolean;
  batch: BatchDetailDto;
  onClose: () => void;
  onSaved: (batch: BatchDetailDto) => void;
}) {
  const [start, setStart] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState('1440');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const minimumMinutes =
    batch.status === 'scheduled' ? batch.settings.lockMinutes : batch.settings.minConfirmLeadMinutes;
  const affected = batch.items.filter((item) => !item.locked && !item.isPaused).length;

  useEffect(() => {
    if (!open) return;
    setStart(suggestStart(minimumMinutes));
    setIntervalMinutes('1440');
    setErrors({});
    setFormError(null);
  }, [open, minimumMinutes]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const parsed = autoScheduleRequestSchema.safeParse({
      startAt: fromDateTimeLocal(start),
      intervalMinutes: Number(intervalMinutes),
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      onSaved(await socialService.autoScheduleBatch(batch.id, parsed.data));
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title="Jadwalkan semua video"
      description={`${affected} baris akan dijadwalkan berurutan sesuai antrean.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="auto-schedule-form" loading={saving} disabled={affected === 0}>
            Generate jadwal
          </Button>
        </>
      }
    >
      <form id="auto-schedule-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField
          label="Video pertama diunggah pada"
          type="datetime-local"
          data-autofocus
          value={start}
          onChange={(event) => setStart(event.target.value)}
          error={errors.startAt}
          hint={
            batch.status === 'scheduled'
              ? `Minimal ${batch.settings.lockMinutes} menit dari sekarang.`
              : `Agar bisa dikonfirmasi, minimal ${batch.settings.minConfirmLeadMinutes} menit dari saat konfirmasi.`
          }
        />
        <SelectField
          label="Selisih antar video"
          value={intervalMinutes}
          onChange={(event) => setIntervalMinutes(event.target.value)}
          error={errors.intervalMinutes}
        >
          {SCHEDULE_INTERVAL_OPTIONS.map((option) => (
            <option key={option.minutes} value={option.minutes}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <Alert variant="info">Baris yang terkunci, sudah terunggah, atau ditunda tidak diubah.</Alert>
      </form>
    </Modal>
  );
}

/** Resuming a paused row of a scheduled batch requires a new schedule. */
export function ResumeItemModal({
  batch,
  item,
  onClose,
  onSaved,
}: {
  batch: BatchDetailDto;
  item: QueueItemDto | null;
  onClose: () => void;
  onSaved: (batch: BatchDetailDto) => void;
}) {
  const [schedule, setSchedule] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    const minimum = Date.now() + batch.settings.lockMinutes * 60_000;
    const current = item.scheduledAt ? new Date(item.scheduledAt).getTime() : 0;
    setSchedule(current > minimum ? toDateTimeLocal(item.scheduledAt) : suggestStart(batch.settings.lockMinutes));
    setError(null);
  }, [item, batch.settings.lockMinutes]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item) return;
    const scheduledAt = fromDateTimeLocal(schedule);
    if (!scheduledAt) {
      setError('Jadwal unggah wajib diisi.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await socialService.resumeItem(batch.id, item.id, { scheduledAt }));
    } catch (err) {
      setError(apiFieldErrors(err).scheduledAt ?? errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      busy={saving}
      title="Lanjutkan baris"
      description={item?.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="resume-item-form" loading={saving}>
            Lanjutkan
          </Button>
        </>
      }
    >
      <form id="resume-item-form" onSubmit={onSubmit} noValidate>
        <TextField
          label="Jadwal unggah baru"
          type="datetime-local"
          data-autofocus
          value={schedule}
          onChange={(event) => setSchedule(event.target.value)}
          error={error ?? undefined}
          hint={`Minimal ${batch.settings.lockMinutes} menit dari sekarang.`}
        />
      </form>
    </Modal>
  );
}

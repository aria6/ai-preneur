import {
  createItemRequestSchema,
  updateItemRequestSchema,
  type BatchDetailDto,
  type QueueItemDto,
  type UpdateItemRequest,
} from '@ai-preneur/shared';
import { useState, type FormEvent } from 'react';

import { Button } from '../../../components/ui/Button';
import { TextAreaField, TextField } from '../../../components/ui/fields';
import { Alert } from '../../../components/ui/feedback';
import { Modal } from '../../../components/ui/Modal';
import { fromDateTimeLocal, toDateTimeLocal } from '../../../lib/datetime';
import { driveViewUrl } from '../../../lib/drive';
import {
  apiFieldErrors,
  errorMessage,
  zodFieldErrors,
  type FieldErrors,
} from '../../../lib/errors';
import * as socialService from '../../../services/social.service';

function parseHashtags(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function hashtagsText(tags: readonly string[]): string {
  return tags.map((tag) => `#${tag}`).join(' ');
}

function optionalNumber(text: string): number | undefined {
  return text.trim() === '' ? undefined : Number(text);
}

interface ItemFormModalProps {
  open: boolean;
  batch: BatchDetailDto;
  /** Undefined → add a row manually. */
  item?: QueueItemDto | undefined;
  onClose: () => void;
  onSaved: (batch: BatchDetailDto) => void;
}

function ItemFormModalContent({ open, batch, item, onClose, onSaved }: ItemFormModalProps) {
  // Initial values, kept to send only what changed when editing.
  const initial = {
    title: item?.title ?? '',
    topic: item ? String(item.topicNumber) : '',
    part: item?.partNumber ? String(item.partNumber) : '',
    videoUrl: item ? driveViewUrl(item.videoFileId) : '',
    thumbnailUrl: item?.thumbnailFileId ? driveViewUrl(item.thumbnailFileId) : '',
    caption: item?.caption ?? '',
    tags: item ? hashtagsText(item.hashtags) : '',
    schedule: toDateTimeLocal(item?.scheduledAt),
  };

  const [title, setTitle] = useState(initial.title);
  const [topic, setTopic] = useState(initial.topic);
  const [part, setPart] = useState(initial.part);
  const [videoUrl, setVideoUrl] = useState(initial.videoUrl);
  const [thumbnailUrl, setThumbnailUrl] = useState(initial.thumbnailUrl);
  const [caption, setCaption] = useState(initial.caption);
  const [tags, setTags] = useState(initial.tags);
  const [schedule, setSchedule] = useState(initial.schedule);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSaving(true);

    try {
      let saved: BatchDetailDto;
      if (item) {
        const patch: UpdateItemRequest = {};
        if (title !== initial.title) patch.title = title;
        if (topic !== initial.topic) patch.topicNumber = optionalNumber(topic) ?? Number.NaN;
        if (part !== initial.part) patch.partNumber = part.trim() === '' ? null : Number(part);
        if (videoUrl.trim() !== initial.videoUrl) patch.videoUrl = videoUrl;
        if (thumbnailUrl.trim() !== initial.thumbnailUrl)
          patch.thumbnailUrl = thumbnailUrl.trim() || null;
        if (caption !== initial.caption) patch.caption = caption;
        if (tags.trim() !== initial.tags) patch.hashtags = parseHashtags(tags);
        if (schedule !== initial.schedule) patch.scheduledAt = fromDateTimeLocal(schedule);
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        const parsed = updateItemRequestSchema.safeParse(patch);
        if (!parsed.success) {
          setErrors(zodFieldErrors(parsed.error));
          return;
        }
        saved = await socialService.updateItem(batch.id, item.id, parsed.data);
      } else {
        const parsed = createItemRequestSchema.safeParse({
          title,
          topicNumber: optionalNumber(topic),
          partNumber: part.trim() === '' ? null : Number(part),
          videoUrl,
          thumbnailUrl: thumbnailUrl.trim() || null,
          caption,
          hashtags: parseHashtags(tags),
          scheduledAt: fromDateTimeLocal(schedule),
        });
        if (!parsed.success) {
          setErrors(zodFieldErrors(parsed.error));
          return;
        }
        saved = await socialService.createItem(batch.id, parsed.data);
      }
      setErrors({});
      onSaved(saved);
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const scheduleHint =
    batch.status === 'scheduled'
      ? `Batch sudah terjadwal: jadwal minimal ${batch.settings.lockMinutes} menit dari sekarang.`
      : 'Boleh dikosongkan dulu, lalu isi lewat "Jadwalkan semua".';

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="lg"
      title={item ? 'Ubah baris' : 'Tambah baris'}
      description={
        item ? item.videoFileName : 'Tambahkan video secara manual dari link file Google Drive.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="item-form" loading={saving}>
            {item ? 'Simpan perubahan' : 'Tambah baris'}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_6rem_6rem]">
          <TextField
            label="Judul topik"
            data-autofocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            error={errors.title}
            maxLength={200}
          />
          <TextField
            label="TOPIC_ID"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Otomatis"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            error={errors.topicNumber}
          />
          <TextField
            label="Part"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="—"
            value={part}
            onChange={(event) => setPart(event.target.value)}
            error={errors.partNumber}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Link video (Google Drive)"
            type="url"
            inputMode="url"
            placeholder="https://drive.google.com/file/d/…/view"
            value={videoUrl}
            onChange={(event) => setVideoUrl(event.target.value)}
            error={errors.videoUrl}
          />
          <TextField
            label="Link thumbnail (opsional)"
            type="url"
            inputMode="url"
            placeholder="https://drive.google.com/file/d/…/view"
            value={thumbnailUrl}
            onChange={(event) => setThumbnailUrl(event.target.value)}
            error={errors.thumbnailUrl}
          />
        </div>

        <TextAreaField
          label="Caption"
          rows={5}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          error={errors.caption}
          maxLength={2200}
          hint={`${caption.length}/2.200 karakter`}
        />

        <TextField
          label="Hashtag"
          placeholder="#akuaponik #urbanfarming"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          error={errors.hashtags}
          hint="Pisahkan dengan spasi atau koma. Maksimal 30 hashtag."
        />

        <TextField
          label="Jadwal unggah"
          type="datetime-local"
          value={schedule}
          onChange={(event) => setSchedule(event.target.value)}
          error={errors.scheduledAt}
          hint={scheduleHint}
        />
      </form>
    </Modal>
  );
}

/** Mounted only while open, so every opening starts from fresh form state (no reset effect). */
export function ItemFormModal(props: Parameters<typeof ItemFormModalContent>[0]) {
  return props.open ? <ItemFormModalContent key={props.item?.id ?? 'new'} {...props} /> : null;
}

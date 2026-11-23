import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  SOCIAL_PLATFORM_LABELS,
  type BatchDetailDto,
  type PublicationDto,
  type QueueItemDto,
} from '@ai-preneur/shared';
import { useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Alert, Badge, Card, EmptyState } from '../../../components/ui/feedback';
import { Icon } from '../../../components/ui/Icon';
import { ConfirmDialog, Modal } from '../../../components/ui/Modal';
import { cn } from '../../../lib/cn';
import { formatSchedule, relativeFromNow } from '../../../lib/datetime';
import { driveThumbnailUrl } from '../../../lib/drive';
import { errorMessage } from '../../../lib/errors';
import * as socialService from '../../../services/social.service';
import { ItemFormModal } from './ItemFormModal';
import { PublicationChip } from './PlatformChip';
import { AutoScheduleModal, ResumeItemModal } from './ScheduleModals';
import { VideoPreviewModal } from './VideoPreviewModal';

/** Shared column template so the header lines up with the rows on large screens. */
const COLUMNS =
  'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_11rem_7rem_6.5rem] lg:items-start lg:gap-4';

function lockText(item: QueueItemDto, lockMinutes: number): string {
  switch (item.lockReason) {
    case 'published':
      return 'Sudah terunggah — hanya bisa dilihat.';
    case 'processing':
      return 'Sedang diunggah — hanya bisa dilihat.';
    case 'imminent':
      return `Kurang dari ${lockMinutes} menit sebelum jadwal — tidak bisa diubah.`;
    default:
      return '';
  }
}

function Thumbnail({ item, onPlay }: { item: QueueItemDto; onPlay: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Putar video ${item.title}`}
      className="group relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:w-20"
    >
      {item.thumbnailFileId && !failed ? (
        <img
          src={driveThumbnailUrl(item.thumbnailFileId)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-slate-400">
          <Icon name="play" className="size-6" />
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-white transition-colors group-hover:bg-slate-900/40">
        <span className="rounded-full bg-slate-900/60 p-1.5 opacity-90 group-hover:opacity-100">
          <Icon name="play" className="size-4" />
        </span>
      </span>
    </button>
  );
}

interface RowProps {
  item: QueueItemDto;
  batch: BatchDetailDto;
  now: Date;
  editable: boolean;
  dragDisabled: boolean;
  onPlay: (item: QueueItemDto) => void;
  onEdit: (item: QueueItemDto) => void;
  onPause: (item: QueueItemDto) => void;
  onResume: (item: QueueItemDto) => void;
  onDelete: (item: QueueItemDto) => void;
  onShowError: (publication: PublicationDto) => void;
}

function QueueRow({
  item,
  batch,
  now,
  editable,
  dragDisabled,
  onPlay,
  onEdit,
  onPause,
  onResume,
  onDelete,
  onShowError,
}: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: dragDisabled,
  });

  const visibleTags = item.hashtags.slice(0, 6);
  const hiddenTags = item.hashtags.length - visibleTags.length;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex gap-3 bg-white px-3 py-4 sm:px-4',
        isDragging && 'relative z-10 shadow-lg ring-1 ring-primary-200',
        item.locked && 'bg-slate-50/70',
      )}
    >
      {/* Drag handle (left) */}
      <div className="flex w-6 shrink-0 justify-center pt-1">
        {item.locked ? (
          <span title={lockText(item, batch.settings.lockMinutes)} className="text-slate-400">
            <Icon name="lock" className="size-4" />
          </span>
        ) : (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            disabled={dragDisabled}
            aria-label={`Pindahkan ${item.title}`}
            className="cursor-grab touch-none rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="grip" className="size-5" strokeWidth={3} />
          </button>
        )}
      </div>

      <Thumbnail item={item} onPlay={() => onPlay(item)} />

      <div className={cn('min-w-0 flex-1 space-y-3 lg:space-y-0', COLUMNS)}>
        {/* Topic */}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-600">
              {batch.ideaNumber}.{item.topicNumber}
            </span>
            {item.partNumber !== null && <Badge>Part {item.partNumber}</Badge>}
          </p>
          <p className="mt-1 font-medium text-slate-900">{item.title}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400" title={item.videoFileName}>
            {item.videoFileName}
          </p>
        </div>

        {/* Caption + hashtags */}
        <div className="min-w-0 text-sm">
          {item.caption ? (
            <p className="line-clamp-3 whitespace-pre-line text-slate-700">{item.caption}</p>
          ) : (
            <p className="text-slate-400 italic">Belum ada caption</p>
          )}
          {visibleTags.length > 0 && (
            <p className="mt-1.5 flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-primary-700">
              {visibleTags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
              {hiddenTags > 0 && <span className="text-slate-400">+{hiddenTags}</span>}
            </p>
          )}
        </div>

        {/* Schedule */}
        <div className="text-sm">
          <p className="text-xs text-slate-500 lg:hidden">Jadwal unggah</p>
          {item.isPaused ? (
            <>
              <Badge color="amber">Ditunda</Badge>
              {item.scheduledAt && (
                <p className="mt-1 text-xs text-slate-400 line-through">
                  {formatSchedule(item.scheduledAt)}
                </p>
              )}
            </>
          ) : item.scheduledAt ? (
            <>
              <p className="font-medium text-slate-900">{formatSchedule(item.scheduledAt)}</p>
              <p className="text-xs text-slate-500">{relativeFromNow(item.scheduledAt, now)}</p>
            </>
          ) : (
            <p className="text-slate-400">Belum dijadwalkan</p>
          )}
        </div>

        {/* Upload status per platform (nothing shown until an upload happened) */}
        <div className="flex flex-wrap gap-1">
          {item.publications.map((publication) => (
            <PublicationChip
              key={publication.platform}
              publication={publication}
              onShowError={onShowError}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-start gap-0.5 lg:justify-end">
          {editable && (
            <>
              <Button
                variant="ghost"
                size="icon"
                title="Ubah"
                aria-label={`Ubah ${item.title}`}
                onClick={() => onEdit(item)}
              >
                <Icon name="edit" className="size-4" />
              </Button>
              {item.isPaused ? (
                <Button
                  variant="ghost"
                  size="icon"
                  title="Lanjutkan"
                  aria-label={`Lanjutkan ${item.title}`}
                  onClick={() => onResume(item)}
                >
                  <Icon name="play" className="size-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  title="Tunda"
                  aria-label={`Tunda ${item.title}`}
                  onClick={() => onPause(item)}
                >
                  <Icon name="pause" className="size-4" />
                </Button>
              )}
              <Button
                variant="dangerGhost"
                size="icon"
                title="Hapus"
                aria-label={`Hapus ${item.title}`}
                onClick={() => onDelete(item)}
              >
                <Icon name="trash" className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

interface QueueSectionProps {
  batch: BatchDetailDto;
  canManage: boolean;
  now: Date;
  onChange: (batch: BatchDetailDto) => void;
  onNotice: (message: string) => void;
}

export function QueueSection({ batch, canManage, now, onChange, onNotice }: QueueSectionProps) {
  const [items, setItems] = useState(batch.items);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [formState, setFormState] = useState<{ open: boolean; item?: QueueItemDto }>({
    open: false,
  });
  const [scheduling, setScheduling] = useState(false);
  const [previewItem, setPreviewItem] = useState<QueueItemDto | null>(null);
  const [resumeTarget, setResumeTarget] = useState<QueueItemDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QueueItemDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [failedPublication, setFailedPublication] = useState<PublicationDto | null>(null);

  // Adopt fresh server data when it changes (adjust-state-during-render, not an effect).
  const [sourceItems, setSourceItems] = useState(batch.items);
  if (sourceItems !== batch.items) {
    setSourceItems(batch.items);
    setItems(batch.items);
  }

  const mutable = canManage && batch.status !== 'completed';

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const run = async (action: () => Promise<BatchDetailDto>, notice?: string) => {
    setError(null);
    setBusy(true);
    try {
      onChange(await action());
      if (notice) onNotice(notice);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;

    const moved = arrayMove(items, from, to);
    if (items.some((item, index) => item.locked && moved[index]?.id !== item.id)) {
      setError(
        'Baris yang terkunci tidak dapat bergeser. Pindahkan baris hanya di antara baris yang belum terkunci.',
      );
      return;
    }

    // Optimistic: time slots stay at their positions, exactly like the server does.
    const previous = items;
    setItems(
      moved.map((item, index) => ({
        ...item,
        position: index,
        scheduledAt: previous[index]?.scheduledAt ?? null,
      })),
    );
    setError(null);
    setBusy(true);
    try {
      onChange(
        await socialService.reorderBatchItems(
          batch.id,
          moved.map((item) => item.id),
        ),
      );
    } catch (err) {
      setItems(previous);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      onChange(await socialService.deleteItem(batch.id, deleteTarget.id));
      onNotice(`Baris "${deleteTarget.title}" dihapus.`);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const onResume = (item: QueueItemDto) => {
    if (batch.status === 'scheduled') setResumeTarget(item);
    else
      void run(
        () => socialService.resumeItem(batch.id, item.id, {}),
        `Baris "${item.title}" dilanjutkan.`,
      );
  };

  // TODO: Generate caption & hashtag with AI for every row (next phase, after Publisher Tahap 1).
  const onGenerateCaption = () => undefined;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-base font-semibold">Antrean konten</h2>
          <p className="text-sm text-slate-500">
            {items.length} video · seret{' '}
            <Icon name="grip" className="inline size-3.5" strokeWidth={3} /> untuk mengubah urutan
            (jadwal tetap di posisinya)
          </p>
        </div>
        {mutable && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setScheduling(true)}
              disabled={busy || items.length === 0}
            >
              <Icon name="calendar" className="size-4" /> Jadwalkan semua
            </Button>
            <Button
              variant="secondary"
              onClick={onGenerateCaption}
              disabled
              title="Segera hadir: generate caption & hashtag otomatis dengan AI"
            >
              <Icon name="sparkles" className="size-4" /> Generate caption
            </Button>
            <Button onClick={() => setFormState({ open: true })} disabled={busy}>
              <Icon name="plus" className="size-4" /> Tambah baris
            </Button>
          </div>
        )}
      </div>

      {error && <Alert className="mx-4 mt-4 sm:mx-5">{error}</Alert>}

      {items.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyState
            icon="folder"
            title="Antrean masih kosong"
            description='Klik "Generate antrean konten" untuk membaca video dari folder Google Drive, atau tambah baris manual.'
          />
        </div>
      ) : (
        <>
          <div
            className={cn(
              'hidden border-b border-slate-100 bg-slate-50 py-2 pr-4 pl-[9rem] text-xs font-semibold tracking-wide text-slate-500 uppercase lg:block',
            )}
          >
            <div className={COLUMNS}>
              <span>Topik</span>
              <span>Caption & hashtag</span>
              <span>Jadwal unggah</span>
              <span>Status</span>
              <span className="text-right">Aksi</span>
            </div>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className={cn('divide-y divide-slate-100', busy && 'opacity-70')}>
                {items.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    batch={batch}
                    now={now}
                    editable={mutable && !item.locked}
                    dragDisabled={!mutable || item.locked || busy}
                    onPlay={setPreviewItem}
                    onEdit={(target) => setFormState({ open: true, item: target })}
                    onPause={(target) =>
                      void run(
                        () => socialService.pauseItem(batch.id, target.id),
                        `Baris "${target.title}" ditunda.`,
                      )
                    }
                    onResume={onResume}
                    onDelete={(target) => {
                      setDeleteError(null);
                      setDeleteTarget(target);
                    }}
                    onShowError={setFailedPublication}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}

      <ItemFormModal
        open={formState.open}
        batch={batch}
        item={formState.item}
        onClose={() => setFormState({ open: false })}
        onSaved={(saved) => {
          onNotice(formState.item ? 'Baris diperbarui.' : 'Baris ditambahkan.');
          setFormState({ open: false });
          onChange(saved);
        }}
      />
      <AutoScheduleModal
        open={scheduling}
        batch={batch}
        onClose={() => setScheduling(false)}
        onSaved={(saved) => {
          setScheduling(false);
          onChange(saved);
          onNotice('Jadwal unggah diisi otomatis.');
        }}
      />
      <ResumeItemModal
        batch={batch}
        item={resumeTarget}
        onClose={() => setResumeTarget(null)}
        onSaved={(saved) => {
          onNotice(`Baris "${resumeTarget?.title ?? ''}" dilanjutkan.`);
          setResumeTarget(null);
          onChange(saved);
        }}
      />
      <VideoPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Hapus baris?"
        message={
          <>
            Baris <strong>{deleteTarget?.title}</strong> akan dihapus dari antrean. Jadwal baris
            lain tidak berubah.
          </>
        }
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
      <Modal
        open={failedPublication !== null}
        onClose={() => setFailedPublication(null)}
        title={`Gagal diunggah ke ${failedPublication ? SOCIAL_PLATFORM_LABELS[failedPublication.platform] : ''}`}
      >
        <Alert>{failedPublication?.errorMessage ?? 'Terjadi kesalahan saat mengunggah.'}</Alert>
      </Modal>
    </Card>
  );
}

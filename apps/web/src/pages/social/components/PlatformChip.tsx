import type { PublicationDto, QueueItemDto, SocialPlatform } from '@ai-preneur/shared';
import { SOCIAL_PLATFORM_LABELS } from '@ai-preneur/shared';

import { Icon } from '../../../components/ui/Icon';
import { cn } from '../../../lib/cn';

/** Short labels instead of brand logos. */
export const PLATFORM_SHORT: Readonly<Record<SocialPlatform, string>> = {
  instagram: 'IG',
  tiktok: 'TT',
  facebook: 'FB',
  youtube: 'YT',
};

const PLATFORM_ACTIVE: Readonly<Record<SocialPlatform, string>> = {
  instagram: 'bg-pink-600 text-white hover:bg-pink-700',
  tiktok: 'bg-slate-900 text-white hover:bg-slate-700',
  facebook: 'bg-blue-600 text-white hover:bg-blue-700',
  youtube: 'bg-red-600 text-white hover:bg-red-700',
};

const CHIP = 'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold';

/** Neutral platform tag (lists, selections). */
export function PlatformTag({ platform }: { platform: SocialPlatform }) {
  return (
    <span
      className={cn(CHIP, 'bg-slate-100 text-slate-600')}
      title={SOCIAL_PLATFORM_LABELS[platform]}
    >
      {PLATFORM_SHORT[platform]}
    </span>
  );
}

type UploadOption = QueueItemDto['uploadOptions'][number];

/**
 * Upload state of one row on one selected platform (always rendered):
 * - published  → active chip linking to the video (+ amber "!" when published with a caveat)
 * - queued / processing → pulsing chip; click shows the progress
 * - failed     → red chip (amber while an automatic retry is pending); click shows the error
 * - none       → muted chip; dashed when "terlewat" (never uploads automatically).
 *                Clickable when "Unggah sekarang" is allowed.
 */
export function PlatformStatusChip({
  platform,
  publication,
  option,
  canManage,
  onOpen,
}: {
  platform: SocialPlatform;
  publication: PublicationDto | null;
  option: UploadOption | undefined;
  canManage: boolean;
  /** Opens the upload dialog (confirm, progress, error or caveat). */
  onOpen: () => void;
}) {
  const label = SOCIAL_PLATFORM_LABELS[platform];
  const short = PLATFORM_SHORT[platform];

  if (publication?.status === 'published') {
    const chip = publication.externalUrl ? (
      <a
        href={publication.externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Terunggah ke ${label} — buka video`}
        className={cn(CHIP, PLATFORM_ACTIVE[platform])}
      >
        {short}
        <Icon name="external" className="size-3" />
      </a>
    ) : (
      <span title={`Terunggah ke ${label}`} className={cn(CHIP, PLATFORM_ACTIVE[platform])}>
        {short}
        <Icon name="check" className="size-3" />
      </span>
    );
    if (!publication.warningMessage) return chip;
    return (
      <span className="inline-flex items-center gap-0.5">
        {chip}
        <button
          type="button"
          onClick={onOpen}
          title={`Terunggah ke ${label} dengan catatan — lihat`}
          aria-label={`Catatan unggahan ${label}`}
          className={cn(
            CHIP,
            'bg-amber-50 px-1 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100',
          )}
        >
          <Icon name="alert" className="size-3" />
        </button>
      </span>
    );
  }

  if (publication?.status === 'queued' || publication?.status === 'processing') {
    return (
      <button
        type="button"
        onClick={onOpen}
        title={`Sedang diunggah ke ${label} — lihat progres`}
        className={cn(CHIP, 'animate-pulse bg-slate-200 text-slate-700 hover:bg-slate-300')}
      >
        {short}
        <Icon name="refresh" className="size-3 animate-spin" />
      </button>
    );
  }

  if (publication?.status === 'failed') {
    const retrying = publication.nextAttemptAt !== null;
    return (
      <button
        type="button"
        onClick={onOpen}
        title={
          retrying
            ? `Gagal diunggah ke ${label}, akan dicoba lagi — lihat detail`
            : `Gagal diunggah ke ${label} — lihat error`
        }
        className={cn(
          CHIP,
          retrying
            ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100'
            : 'bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100',
        )}
      >
        {short}
        <Icon name="alert" className="size-3" />
      </button>
    );
  }

  // Not uploaded yet.
  const missed = option?.missed ?? false;
  const allowed = canManage && option !== undefined && option.blockedReason === null;
  const state = missed ? 'terlewat, tidak diunggah otomatis' : 'belum diunggah';
  const style = cn(
    CHIP,
    'border bg-white',
    missed ? 'border-dashed border-slate-400 text-slate-500' : 'border-slate-200 text-slate-400',
  );

  if (!allowed) {
    const reason = canManage && option?.blockedReason ? ` (${option.blockedReason})` : '';
    return (
      <span title={`${label}: ${state}${reason}`} className={style}>
        {short}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${label}: ${state} — klik untuk unggah sekarang`}
      className={cn(style, 'hover:bg-slate-50 hover:text-slate-700')}
    >
      {short}
      <Icon name="play" className="size-3" />
    </button>
  );
}

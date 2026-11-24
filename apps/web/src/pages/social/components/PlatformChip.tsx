import type { PublicationDto, SocialPlatform } from '@ai-preneur/shared';
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

/**
 * Upload state of one row on one platform:
 * - published  → active chip linking to the uploaded video
 *                 (+ amber "!" button when it was published with a caveat)
 * - failed     → red chip (amber while an automatic retry is pending); click shows the error
 * - processing → muted, pulsing chip
 * (No publication → nothing is rendered.)
 */
export function PublicationChip({
  publication,
  onShowError,
}: {
  publication: PublicationDto;
  /** Opens the details: the error of a failed upload or the caveat of a published one. */
  onShowError: (publication: PublicationDto) => void;
}) {
  const label = SOCIAL_PLATFORM_LABELS[publication.platform];
  const short = PLATFORM_SHORT[publication.platform];

  if (publication.status === 'published') {
    const chip = publication.externalUrl ? (
      <a
        href={publication.externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Terunggah ke ${label} — buka video`}
        className={cn(CHIP, PLATFORM_ACTIVE[publication.platform])}
      >
        {short}
        <Icon name="external" className="size-3" />
      </a>
    ) : (
      <span
        title={`Terunggah ke ${label}`}
        className={cn(CHIP, PLATFORM_ACTIVE[publication.platform])}
      >
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
          onClick={() => onShowError(publication)}
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

  if (publication.status === 'failed') {
    const retrying = publication.nextAttemptAt !== null;
    return (
      <button
        type="button"
        onClick={() => onShowError(publication)}
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

  return (
    <span
      title={`Sedang diunggah ke ${label}`}
      className={cn(CHIP, 'animate-pulse bg-slate-100 text-slate-500')}
    >
      {short}
    </span>
  );
}

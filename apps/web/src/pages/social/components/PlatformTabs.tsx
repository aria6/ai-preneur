import {
  AVAILABLE_SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORMS,
  socialPlatformSchema,
  type SocialPlatform,
} from '@ai-preneur/shared';
import { useSearchParams } from 'react-router';

import { cn } from '../../../lib/cn';

/** Selected platform tab, kept in the URL (`?platform=tiktok`). Default Instagram. */
export function usePlatformParam(): [SocialPlatform, (next: SocialPlatform) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = socialPlatformSchema.safeParse(searchParams.get('platform'));
  const platform: SocialPlatform = parsed.success ? parsed.data : 'instagram';
  // Other parameters of the page (e.g. its inner tab) are kept.
  const select = (next: SocialPlatform) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === 'instagram') params.delete('platform');
        else params.set('platform', next);
        return params;
      },
      { replace: true },
    );
  return [platform, select];
}

/** Instagram · TikTok · Facebook Reels · YouTube Shorts; unsupported ones say "Segera hadir". */
export function PlatformTabs({
  value,
  onChange,
}: {
  value: SocialPlatform;
  onChange: (next: SocialPlatform) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Platform"
      className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200"
    >
      {SOCIAL_PLATFORMS.map((candidate) => {
        const available = AVAILABLE_SOCIAL_PLATFORMS.includes(candidate);
        const selected = candidate === value;
        return (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(candidate)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm whitespace-nowrap',
              selected
                ? 'border-primary-600 font-medium text-primary-700'
                : 'border-transparent text-slate-600 hover:text-slate-900',
            )}
          >
            {SOCIAL_PLATFORM_LABELS[candidate]}
            {!available && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                Segera hadir
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

import type { SocialPlatform } from '@ai-preneur/shared';
import { Link } from 'react-router';

import { Icon } from '../../../components/ui/Icon';
import { PlatformTabs } from './PlatformTabs';

/**
 * Compact header of an idea's detail page (Performance AIgent, Data Collection AIgent):
 * back link, title with IDEA_ID/Arsip chips and the platform tabs in one block, with a
 * single divider line.
 */
export function IdeaDetailHeader({
  backTo,
  backLabel,
  idea,
  platform,
  onPlatformChange,
}: {
  backTo: string;
  backLabel: string;
  idea: { title: string; ideaNumber: number; archivedAt: string | null };
  platform: SocialPlatform;
  onPlatformChange: (next: SocialPlatform) => void;
}) {
  return (
    <div className="mb-5 border-b border-slate-200">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
      >
        <Icon name="chevronLeft" className="size-3.5" /> {backLabel}
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          {idea.title}
        </h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          IDEA_ID {idea.ideaNumber}
        </span>
        {idea.archivedAt && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            Arsip
          </span>
        )}
      </div>
      <PlatformTabs value={platform} onChange={onPlatformChange} />
    </div>
  );
}

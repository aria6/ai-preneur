import {
  AVAILABLE_SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORMS,
  socialPlatformSchema,
  type PerformanceIdeaDto,
  type SocialPlatform,
} from '@ai-preneur/shared';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { Alert, EmptyState, PageHeader } from '../../../components/ui/feedback';
import { Icon } from '../../../components/ui/Icon';
import { Spinner } from '../../../components/ui/Spinner';
import { cn } from '../../../lib/cn';
import { errorMessage } from '../../../lib/errors';
import * as performanceService from '../../../services/social-performance.service';
import { InstagramPanel } from './InstagramPanel';

const BackLink = () => (
  <Link
    to="/social/performance"
    className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
  >
    <Icon name="chevronLeft" className="size-4" /> Performance AIgent
  </Link>
);

export function PerformanceDetailPage() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedPlatform = socialPlatformSchema.safeParse(searchParams.get('platform'));
  const platform: SocialPlatform = parsedPlatform.success ? parsedPlatform.data : 'instagram';

  const [idea, setIdea] = useState<PerformanceIdeaDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    performanceService
      .getPerformanceIdea(id, controller.signal)
      .then(setIdea)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      });
    return () => controller.abort();
  }, [id]);

  if (loadError && !idea) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert>{loadError}</Alert>
      </div>
    );
  }

  if (!idea) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Spinner className="size-7" />
      </div>
    );
  }

  const selectPlatform = (next: SocialPlatform) =>
    setSearchParams(next === 'instagram' ? {} : { platform: next }, { replace: true });

  return (
    <>
      <div className="mb-3">
        <BackLink />
      </div>
      <PageHeader
        title={idea.title}
        description={`IDEA_ID ${idea.ideaNumber}${idea.archivedAt ? ' · Arsip' : ''}`}
      />

      <div
        role="tablist"
        aria-label="Platform"
        className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200"
      >
        {SOCIAL_PLATFORMS.map((candidate) => {
          const available = AVAILABLE_SOCIAL_PLATFORMS.includes(candidate);
          const selected = candidate === platform;
          return (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectPlatform(candidate)}
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

      <div role="tabpanel">
        {platform === 'instagram' ? (
          <InstagramPanel
            ideaId={idea.id}
            account={idea.accounts.find((account) => account.platform === 'instagram')}
          />
        ) : (
          <EmptyState
            icon="chart"
            title={`${SOCIAL_PLATFORM_LABELS[platform]} segera hadir`}
            description="Data performa platform ini akan tersedia setelah koneksi akunnya didukung."
          />
        )}
      </div>
    </>
  );
}

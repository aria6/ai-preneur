import { SOCIAL_PLATFORM_LABELS, type PerformanceIdeaDto } from '@ai-preneur/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Alert, EmptyState } from '../../../components/ui/feedback';
import { Icon } from '../../../components/ui/Icon';
import { Spinner } from '../../../components/ui/Spinner';
import { errorMessage } from '../../../lib/errors';
import * as performanceService from '../../../services/social-performance.service';
import { IdeaDetailHeader } from '../components/IdeaDetailHeader';
import { usePlatformParam } from '../components/PlatformTabs';
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
  const [platform, selectPlatform] = usePlatformParam();

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

  return (
    <>
      <IdeaDetailHeader
        backTo="/social/performance"
        backLabel="Performance AIgent"
        idea={idea}
        platform={platform}
        onPlatformChange={selectPlatform}
      />

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

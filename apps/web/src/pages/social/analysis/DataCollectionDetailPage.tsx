import { SOCIAL_PLATFORM_LABELS, type AnalysisIdeaDto } from '@ai-preneur/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Alert, EmptyState } from '../../../components/ui/feedback';
import { Icon } from '../../../components/ui/Icon';
import { Spinner } from '../../../components/ui/Spinner';
import { errorMessage } from '../../../lib/errors';
import * as analysisService from '../../../services/social-analysis.service';
import { IdeaDetailHeader } from '../components/IdeaDetailHeader';
import { usePlatformParam } from '../components/PlatformTabs';
import { InstagramCollectionPanel } from './InstagramCollectionPanel';

const BackLink = () => (
  <Link
    to="/social/analysis/collection"
    className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
  >
    <Icon name="chevronLeft" className="size-4" /> Data Collection AIgent
  </Link>
);

export function DataCollectionDetailPage() {
  const { id = '' } = useParams();
  const [platform, selectPlatform] = usePlatformParam();
  const [idea, setIdea] = useState<AnalysisIdeaDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    analysisService
      .getAnalysisIdea(id, controller.signal)
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
        backTo="/social/analysis/collection"
        backLabel="Data Collection AIgent"
        idea={idea}
        platform={platform}
        onPlatformChange={selectPlatform}
      />

      <div role="tabpanel">
        {platform === 'instagram' ? (
          <InstagramCollectionPanel
            ideaId={idea.id}
            account={idea.accounts.find((account) => account.platform === 'instagram')}
          />
        ) : (
          <EmptyState
            icon="search"
            title={`${SOCIAL_PLATFORM_LABELS[platform]} segera hadir`}
            description="Komentar dan DM platform ini bisa dikumpulkan setelah koneksi akunnya didukung."
          />
        )}
      </div>
    </>
  );
}

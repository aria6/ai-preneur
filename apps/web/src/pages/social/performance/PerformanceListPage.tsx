import type { InstagramOverviewDto, PerformanceIdeaDto } from '@ai-preneur/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Alert, EmptyState, PageHeader } from '../../../components/ui/feedback';
import { Spinner } from '../../../components/ui/Spinner';
import { errorMessage } from '../../../lib/errors';
import * as performanceService from '../../../services/social-performance.service';
import { AccountStatusList, formatMetric } from './performance-ui';

/** Followers, 7-day views and interactions of the idea's Instagram account. */
function InstagramQuickStats({ idea }: { idea: PerformanceIdeaDto }) {
  const account = idea.accounts.find((candidate) => candidate.platform === 'instagram');
  const usable = account?.status === 'connected';
  const [overview, setOverview] = useState<InstagramOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!usable) return;
    const controller = new AbortController();
    performanceService
      .getInstagramOverview(idea.id, { days: 7, signal: controller.signal })
      .then(setOverview)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [idea.id, usable]);

  if (!usable) return null;
  if (error) return <p className="line-clamp-2 text-xs text-amber-700">{error}</p>;
  if (!overview) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Spinner className="size-4" /> Mengambil data Instagram…
      </div>
    );
  }

  const stats = [
    { label: 'Pengikut', value: overview.profile.followersCount },
    { label: 'Views 7 hari', value: overview.totals.views },
    { label: 'Interaksi 7 hari', value: overview.totals.totalInteractions },
  ];
  return (
    <dl className="grid grid-cols-3 gap-3">
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt className="text-xs text-slate-500">{stat.label}</dt>
          <dd className="font-semibold text-slate-900 tabular-nums">{formatMetric(stat.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function IdeaPerformanceCard({ idea }: { idea: PerformanceIdeaDto }) {
  return (
    <Link
      to={`/social/performance/${idea.id}`}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition-colors hover:border-primary-300 focus-visible:outline-2 focus-visible:outline-primary-500"
    >
      <p className="text-xs font-medium text-slate-500">IDEA_ID {idea.ideaNumber}</p>
      <h2 className="mt-0.5 truncate font-semibold text-slate-900 group-hover:text-primary-700">
        {idea.title}
      </h2>
      <div className="mt-4">
        <AccountStatusList accounts={idea.accounts} />
      </div>
      <div className="mt-4 border-t border-slate-100 pt-4">
        {idea.accounts.some((account) => account.platform === 'instagram') ? (
          <InstagramQuickStats idea={idea} />
        ) : (
          <p className="text-xs text-slate-400">Belum ada akun yang terhubung.</p>
        )}
      </div>
    </Link>
  );
}

export function PerformanceListPage() {
  const [ideas, setIdeas] = useState<PerformanceIdeaDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    performanceService
      .listPerformanceIdeas(controller.signal)
      .then(setIdeas)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <PageHeader
        title="Performance AIgent"
        description="Performa akun media sosial tiap ide, diambil langsung dari platform."
      />

      {loadError ? (
        <Alert>{loadError}</Alert>
      ) : ideas === null ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="size-7" />
        </div>
      ) : ideas.length === 0 ? (
        <EmptyState
          icon="chart"
          title="Belum ada ide"
          description="Buat ide di Publisher AIgent dan hubungkan akun media sosialnya untuk melihat performanya di sini."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ideas.map((idea) => (
            <IdeaPerformanceCard key={idea.id} idea={idea} />
          ))}
        </div>
      )}
    </>
  );
}

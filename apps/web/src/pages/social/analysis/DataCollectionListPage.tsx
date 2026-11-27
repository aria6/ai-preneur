import type { AnalysisIdeaDto, IdeaListFilter } from '@ai-preneur/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Alert, EmptyState, PageHeader } from '../../../components/ui/feedback';
import { Spinner } from '../../../components/ui/Spinner';
import { errorMessage } from '../../../lib/errors';
import { formatDateTime } from '../../../lib/format';
import * as analysisService from '../../../services/social-analysis.service';
import { IdeaFilterTabs, useIdeaListFilter } from '../components/IdeaFilterTabs';
import { AccountStatusList, formatMetric } from '../performance/performance-ui';

function CollectionSummary({ idea }: { idea: AnalysisIdeaDto }) {
  const summary = idea.instagram;
  if (idea.instagramRunning) {
    return (
      <p className="flex items-center gap-2 text-xs text-primary-700">
        <Spinner className="size-4" /> Sedang mengambil data…
      </p>
    );
  }
  if (!summary?.initialCompletedAt) {
    return <p className="text-xs text-slate-400">Data belum pernah diambil.</p>;
  }
  const stats = [
    { label: 'Komentar', value: summary.commentCount },
    { label: 'Percakapan DM', value: summary.conversationCount },
    { label: 'Pesan DM', value: summary.messageCount },
  ];
  return (
    <>
      <dl className="grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-xs text-slate-500">{stat.label}</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">
              {formatMetric(stat.value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        Diperbarui {formatDateTime(summary.lastSucceededAt)}
      </p>
    </>
  );
}

function IdeaCollectionCard({ idea }: { idea: AnalysisIdeaDto }) {
  return (
    <Link
      to={`/social/analysis/collection/${idea.id}`}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition-colors hover:border-primary-300 focus-visible:outline-2 focus-visible:outline-primary-500"
    >
      <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
        IDEA_ID {idea.ideaNumber}
        {idea.archivedAt && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Arsip</span>
        )}
      </p>
      <h2 className="mt-0.5 truncate font-semibold text-slate-900 group-hover:text-primary-700">
        {idea.title}
      </h2>
      <div className="mt-4">
        <AccountStatusList accounts={idea.accounts} />
      </div>
      <div className="mt-4 border-t border-slate-100 pt-4">
        <CollectionSummary idea={idea} />
      </div>
    </Link>
  );
}

export function DataCollectionListPage() {
  const [filter, setFilter] = useIdeaListFilter();
  const [loaded, setLoaded] = useState<{
    filter: IdeaListFilter;
    ideas: AnalysisIdeaDto[] | null;
    error: string | null;
  } | null>(null);
  const current = loaded?.filter === filter ? loaded : null;
  const ideas = current?.ideas ?? null;
  const loadError = current?.error ?? null;

  useEffect(() => {
    const controller = new AbortController();
    analysisService
      .listAnalysisIdeas(filter, controller.signal)
      .then((items) => setLoaded({ filter, ideas: items, error: null }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({ filter, ideas: null, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [filter]);

  return (
    <>
      <PageHeader
        title="Data Collection AIgent"
        description="Mengumpulkan komentar dan DM akun media sosial tiap ide ke database. Pengambilan pertama membaca 90 hari terakhir; setelah itu hanya data baru yang diambil."
      />
      <IdeaFilterTabs value={filter} onChange={setFilter} />

      {loadError ? (
        <Alert>{loadError}</Alert>
      ) : ideas === null ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="size-7" />
        </div>
      ) : ideas.length === 0 ? (
        <EmptyState
          icon="search"
          title={filter === 'archived' ? 'Belum ada ide yang diarsip' : 'Belum ada ide'}
          description="Buat ide di Publisher AIgent dan hubungkan akun media sosialnya untuk mengumpulkan komentar dan DM-nya di sini."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ideas.map((idea) => (
            <IdeaCollectionCard key={idea.id} idea={idea} />
          ))}
        </div>
      )}
    </>
  );
}

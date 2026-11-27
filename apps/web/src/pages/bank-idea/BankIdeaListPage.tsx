import {
  BANK_IDEA_AGENCIES,
  BANK_IDEA_AGENCY_LABELS,
  BANK_IDEA_LABEL_TEXT,
  BANK_IDEA_LABELS,
  BANK_IDEA_MARKET_SCOPE_LABELS,
  BANK_IDEA_STAGE_LABELS,
  BANK_IDEA_STAGES,
  PERMISSIONS,
  type BankIdeaListFilter,
  type BankIdeaSummaryDto,
} from '@ai-preneur/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/fields';
import { Alert, Badge, EmptyState, PageHeader } from '../../components/ui/feedback';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { useAuth } from '../../hooks/use-auth';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import * as bankIdeaService from '../../services/bank-idea.service';
import { IdeaFilterTabs, useIdeaListFilter } from '../social/components/IdeaFilterTabs';
import { ActiveRunBadge, LabelBadge, ScoreCircle, StageBadge } from './bank-idea-ui';

const POLL_MS = 10_000;

type Sort = 'newest' | 'score_desc' | 'score_asc';
const SORT_LABELS: Record<Sort, string> = {
  newest: 'Terbaru',
  score_desc: 'Skor tertinggi',
  score_asc: 'Skor terendah',
};

function sortIdeas(items: BankIdeaSummaryDto[], sort: Sort): BankIdeaSummaryDto[] {
  if (sort === 'newest') return items;
  // Ideas without a score always go last.
  return items.toSorted((a, b) => {
    if (a.latestScore === null) return b.latestScore === null ? 0 : 1;
    if (b.latestScore === null) return -1;
    return sort === 'score_desc' ? b.latestScore - a.latestScore : a.latestScore - b.latestScore;
  });
}

function IdeaRow({ idea }: { idea: BankIdeaSummaryDto }) {
  return (
    <Link
      to={`/bank-idea/${idea.id}`}
      className="group flex gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-colors hover:border-primary-300 focus-visible:outline-2 focus-visible:outline-primary-500"
    >
      <ScoreCircle score={idea.latestScore} label={idea.latestLabel} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate font-semibold text-slate-900 group-hover:text-primary-700">
            {idea.title}
          </h2>
          {idea.latestLabel && <LabelBadge label={idea.latestLabel} />}
          <StageBadge stage={idea.stage} archived={idea.archivedAt !== null} />
          {idea.activeRun && <ActiveRunBadge run={idea.activeRun} />}
          {idea.changedSinceResearch && <Badge color="amber">Berubah sejak riset</Badge>}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-500">{idea.summary}</p>
        <p className="mt-2 text-xs text-slate-500">
          {BANK_IDEA_AGENCY_LABELS[idea.agency]} · Pasar{' '}
          {BANK_IDEA_MARKET_SCOPE_LABELS[idea.marketScope]} ·{' '}
          {idea.lastResearchedAt
            ? `Riset ${formatDateTime(idea.lastResearchedAt)}`
            : 'Belum diriset'}
        </p>
      </div>
    </Link>
  );
}

export function BankIdeaListPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.BANK_IDEA_MANAGE);
  const [filter, setFilter] = useIdeaListFilter();
  const [loaded, setLoaded] = useState<{
    filter: BankIdeaListFilter;
    items: BankIdeaSummaryDto[] | null;
    error: string | null;
  } | null>(null);
  const current = loaded?.filter === filter ? loaded : null;
  const items = current?.items ?? null;
  const loadError = current?.error ?? null;

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);
  const [agency, setAgency] = useState('');
  const [label, setLabel] = useState('');
  const [stage, setStage] = useState('');
  const [sort, setSort] = useState<Sort>('newest');

  const hasActive = items?.some((idea) => idea.activeRun !== null) ?? false;

  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      bankIdeaService
        .listIdeas(filter, controller.signal)
        .then((list) => setLoaded({ filter, items: list, error: null }))
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setLoaded({ filter, items: null, error: errorMessage(error) });
        });
    void load();
    // Refresh while a research is queued or running, so scores appear by themselves.
    const timer = hasActive ? setInterval(() => void load(), POLL_MS) : undefined;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [filter, hasActive]);

  const visible = useMemo(() => {
    if (!items) return null;
    const q = debouncedQuery.trim().toLowerCase();
    const filtered = items.filter(
      (idea) =>
        (!q || idea.title.toLowerCase().includes(q) || idea.summary.toLowerCase().includes(q)) &&
        (!agency || idea.agency === agency) &&
        (!label || (label === 'none' ? idea.latestLabel === null : idea.latestLabel === label)) &&
        (!stage || idea.stage === stage),
    );
    return sortIdeas(filtered, sort);
  }, [items, debouncedQuery, agency, label, stage, sort]);

  const addButton = canManage && (
    <Button onClick={() => navigate('/bank-idea/baru')}>
      <Icon name="plus" className="size-4" /> Tambah ide
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Bank Idea"
        description="Kumpulkan semua ide, riset dengan AI (tren, pasar, kompetitor, monetisasi), lalu bandingkan skornya."
        actions={addButton}
      />

      <IdeaFilterTabs value={filter} onChange={setFilter} />

      {items && items.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-1">
            <TextField
              label="Cari"
              placeholder="Judul atau ringkasan"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <SelectField
            label="Kategori"
            value={agency}
            onChange={(event) => setAgency(event.target.value)}
          >
            <option value="">Semua kategori</option>
            {BANK_IDEA_AGENCIES.map((key) => (
              <option key={key} value={key}>
                {BANK_IDEA_AGENCY_LABELS[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Label skor"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          >
            <option value="">Semua label</option>
            {BANK_IDEA_LABELS.map((key) => (
              <option key={key} value={key}>
                {BANK_IDEA_LABEL_TEXT[key]}
              </option>
            ))}
            <option value="none">Belum diriset</option>
          </SelectField>
          <SelectField
            label="Status"
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            <option value="">Semua status</option>
            {BANK_IDEA_STAGES.map((key) => (
              <option key={key} value={key}>
                {BANK_IDEA_STAGE_LABELS[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Urutkan"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
          >
            {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </SelectField>
        </div>
      )}

      {loadError ? (
        <Alert>{loadError}</Alert>
      ) : visible === null ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="size-7" />
        </div>
      ) : items?.length === 0 && filter === 'archived' ? (
        <EmptyState
          icon="lightbulb"
          title="Belum ada ide yang diarsip"
          description="Ide bisa diarsip dari halaman detailnya."
        />
      ) : items?.length === 0 ? (
        <EmptyState
          icon="lightbulb"
          title="Bank Idea masih kosong"
          description="Tambahkan ide pertama: tempel ide mentah, rapikan dengan AI, lalu riset untuk mendapatkan skornya."
          action={addButton}
        />
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          Tidak ada ide yang cocok dengan filter.
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((idea) => (
            <IdeaRow key={idea.id} idea={idea} />
          ))}
        </div>
      )}
    </>
  );
}

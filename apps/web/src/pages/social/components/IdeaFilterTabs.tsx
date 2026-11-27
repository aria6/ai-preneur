import type { IdeaListFilter } from '@ai-preneur/shared';
import { useSearchParams } from 'react-router';

import { cn } from '../../../lib/cn';

const LABELS: Record<IdeaListFilter, string> = { active: 'Aktif', archived: 'Arsip' };

/** Aktif / Arsip filter of the idea lists, kept in the URL (`?filter=arsip`). Default Aktif. */
export function useIdeaListFilter(): [IdeaListFilter, (next: IdeaListFilter) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter: IdeaListFilter = searchParams.get('filter') === 'arsip' ? 'archived' : 'active';
  const setFilter = (next: IdeaListFilter) =>
    setSearchParams(next === 'archived' ? { filter: 'arsip' } : {}, { replace: true });
  return [filter, setFilter];
}

export function IdeaFilterTabs({
  value,
  onChange,
}: {
  value: IdeaListFilter;
  onChange: (next: IdeaListFilter) => void;
}) {
  return (
    <div
      className="mb-5 inline-flex rounded-lg border border-slate-300 bg-white p-0.5"
      role="group"
      aria-label="Filter ide"
    >
      {(Object.keys(LABELS) as IdeaListFilter[]).map((filter) => (
        <button
          key={filter}
          type="button"
          aria-pressed={value === filter}
          onClick={() => onChange(filter)}
          className={cn(
            'h-8 rounded-md px-4 text-sm',
            value === filter
              ? 'bg-primary-600 font-medium text-white'
              : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          {LABELS[filter]}
        </button>
      ))}
    </div>
  );
}

import {
  BANK_IDEA_LABEL_TEXT,
  BANK_IDEA_MARKET_SCOPE_LABELS,
  BANK_IDEA_MARKET_SCOPES,
  BANK_IDEA_STAGE_LABELS,
  BANK_IDEA_TEXT_MAX_LENGTH,
  BANK_IDEA_TITLE_MAX_LENGTH,
  type BankIdeaActiveRunDto,
  type BankIdeaLabel,
  type BankIdeaMarketScope,
  type BankIdeaStage,
} from '@ai-preneur/shared';

import { SelectField, TextAreaField, TextField } from '../../components/ui/fields';
import { Badge } from '../../components/ui/feedback';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/cn';
import type { FieldErrors } from '../../lib/errors';
import { useState, type ReactNode } from 'react';

export const LABEL_STYLES: Record<
  BankIdeaLabel,
  { badge: 'green' | 'amber' | 'gray'; ring: string; text: string }
> = {
  execute: { badge: 'green', ring: 'border-emerald-500', text: 'text-emerald-700' },
  validate: { badge: 'amber', ring: 'border-amber-500', text: 'text-amber-700' },
  park: { badge: 'gray', ring: 'border-slate-400', text: 'text-slate-600' },
};

export function LabelBadge({ label }: { label: BankIdeaLabel }) {
  return <Badge color={LABEL_STYLES[label].badge}>{BANK_IDEA_LABEL_TEXT[label]}</Badge>;
}

export function StageBadge({ stage, archived }: { stage: BankIdeaStage; archived: boolean }) {
  if (archived) return <Badge color="gray">Arsip</Badge>;
  return (
    <Badge color={stage === 'executed' ? 'violet' : stage === 'researched' ? 'green' : 'gray'}>
      {BANK_IDEA_STAGE_LABELS[stage]}
    </Badge>
  );
}

/** Big round score: total 0–100 colored by its label. */
export function ScoreCircle({
  score,
  label,
  size = 'md',
}: {
  score: number | null;
  label: BankIdeaLabel | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const style = label ? LABEL_STYLES[label] : null;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border-[3px] font-semibold tabular-nums',
        style ? `${style.ring} ${style.text}` : 'border-dashed border-slate-300 text-slate-400',
        size === 'sm' && 'size-11 text-sm',
        size === 'md' && 'size-14 text-lg',
        size === 'lg' && 'size-24 text-3xl',
      )}
      aria-label={score === null ? 'Belum ada skor' : `Skor ${score} dari 100`}
    >
      {score ?? '–'}
    </span>
  );
}

export function ActiveRunBadge({ run }: { run: BankIdeaActiveRunDto }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
      {run.status === 'running' ? (
        <>
          <Spinner className="size-3" /> Sedang diriset
        </>
      ) : (
        <>Antrean ke-{run.queuePosition}</>
      )}
    </span>
  );
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} dtk`;
  return `${Math.floor(seconds / 60)} mnt ${seconds % 60} dtk`;
}

// ---- Idea form fields (create + edit) ---------------------------------------------------

export interface IdeaFormValues {
  title: string;
  summary: string;
  problem: string;
  solution: string;
  marketScope: BankIdeaMarketScope;
}

export const EMPTY_IDEA_FORM: IdeaFormValues = {
  title: '',
  summary: '',
  problem: '',
  solution: '',
  marketScope: 'indonesia',
};

const counter = (value: string, max: number) =>
  `${value.length.toLocaleString('id-ID')}/${max.toLocaleString('id-ID')} karakter`;

export function IdeaFields({
  values,
  onChange,
  errors,
}: {
  values: IdeaFormValues;
  onChange: (next: IdeaFormValues) => void;
  errors: FieldErrors;
}) {
  const set = <K extends keyof IdeaFormValues>(key: K, value: IdeaFormValues[K]) =>
    onChange({ ...values, [key]: value });

  return (
    <div className="space-y-4">
      <TextField
        label="Judul ide"
        value={values.title}
        onChange={(event) => set('title', event.target.value)}
        error={errors.title}
        maxLength={BANK_IDEA_TITLE_MAX_LENGTH}
      />
      <TextAreaField
        label="Ringkasan"
        rows={3}
        value={values.summary}
        onChange={(event) => set('summary', event.target.value)}
        error={errors.summary}
        maxLength={BANK_IDEA_TEXT_MAX_LENGTH}
        hint={counter(values.summary, BANK_IDEA_TEXT_MAX_LENGTH)}
      />
      <TextAreaField
        label="Masalah yang diselesaikan (opsional)"
        rows={2}
        value={values.problem}
        onChange={(event) => set('problem', event.target.value)}
        error={errors.problem}
        maxLength={BANK_IDEA_TEXT_MAX_LENGTH}
      />
      <TextAreaField
        label="Solusi (opsional)"
        rows={2}
        value={values.solution}
        onChange={(event) => set('solution', event.target.value)}
        error={errors.solution}
        maxLength={BANK_IDEA_TEXT_MAX_LENGTH}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Cakupan pasar riset"
          value={values.marketScope}
          onChange={(event) => set('marketScope', event.target.value as BankIdeaMarketScope)}
          error={errors.marketScope}
        >
          {BANK_IDEA_MARKET_SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {BANK_IDEA_MARKET_SCOPE_LABELS[scope]}
            </option>
          ))}
        </SelectField>
      </div>
    </div>
  );
}

/** A card whose body is hidden until its header is clicked. */
export function Collapsible({
  id,
  title,
  meta,
  open,
  onToggle,
  children,
}: {
  id?: string;
  title: string;
  /** Short text next to the title (e.g. a count). */
  meta?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-xl border border-slate-200 bg-white shadow-xs">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-5 py-4 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary-500"
      >
        <span className="font-semibold text-slate-900">
          {title}
          {meta && <span className="ml-2 text-sm font-normal text-slate-500">{meta}</span>}
        </span>
        <Icon
          name="chevronDown"
          className={cn(
            'size-5 shrink-0 text-slate-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && <div className="border-t border-slate-100 p-5">{children}</div>}
    </section>
  );
}

/** Collapsible that keeps its own open state. */
export function CollapsibleCard(props: {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <Collapsible
      title={props.title}
      meta={props.meta}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {props.children}
    </Collapsible>
  );
}

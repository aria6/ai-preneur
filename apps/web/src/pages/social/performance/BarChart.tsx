import { useState } from 'react';

import { cn } from '../../../lib/cn';

export interface BarDatum {
  /** Axis label (short), e.g. "20 Nov". */
  label: string;
  value: number;
  /** Tooltip heading; defaults to the label. */
  title?: string;
}

const compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('id-ID');

/** Rounds the axis maximum up to a readable number (1, 2, 5 × 10ⁿ). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((factor) => factor * magnitude >= value) ?? 10;
  return step * magnitude;
}

/**
 * Single-series bar chart (one hue, so no legend — the card title names the series).
 * Thin bars with rounded tops, a recessive grid, sparse axis labels and a tooltip on
 * hover/focus. A screen-reader table carries the same numbers.
 */
export function BarChart({
  data,
  valueLabel,
  height = 180,
}: {
  data: readonly BarDatum[];
  /** Unit name shown in the tooltip, e.g. "reach". */
  valueLabel: string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((datum) => datum.value)));
  // Show at most ~8 axis labels so they never collide.
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const activeDatum = active === null ? undefined : data[active];

  return (
    <div className="pt-10">
      <div className="flex gap-2">
        <div
          className="flex flex-col justify-between text-right text-[11px] text-slate-400 tabular-nums"
          style={{ height }}
          aria-hidden="true"
        >
          <span>{compact.format(max)}</span>
          <span>{compact.format(max / 2)}</span>
          <span>0</span>
        </div>

        <div className="relative min-w-0 flex-1">
          <div
            className="relative flex items-end gap-[2px] border-b border-slate-200"
            style={{ height }}
            onMouseLeave={() => setActive(null)}
            aria-hidden="true"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-slate-100" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-slate-100" />
            {data.map((datum, index) => (
              <div
                key={`${datum.label}-${index}`}
                className="group relative flex h-full flex-1 items-end justify-center"
                onMouseEnter={() => setActive(index)}
              >
                <div
                  className={cn(
                    'w-full max-w-6 rounded-t-[4px] transition-colors',
                    active === index ? 'bg-primary-700' : 'bg-primary-500',
                  )}
                  style={{
                    height: `${(datum.value / max) * 100}%`,
                    minHeight: datum.value > 0 ? 2 : 0,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="relative mt-1 h-4 text-[11px] text-slate-400" aria-hidden="true">
            {data.map((datum, index) =>
              index % labelEvery === 0 ? (
                <span
                  key={`${datum.label}-${index}`}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${((index + 0.5) / data.length) * 100}%` }}
                >
                  {datum.label}
                </span>
              ) : null,
            )}
          </div>

          {activeDatum && active !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow-md"
              style={{ left: `${((active + 0.5) / data.length) * 100}%` }}
            >
              <p className="font-medium">{activeDatum.title ?? activeDatum.label}</p>
              <p className="tabular-nums">
                {full.format(activeDatum.value)} {valueLabel}
              </p>
            </div>
          )}
        </div>
      </div>

      <table className="sr-only">
        <tbody>
          {data.map((datum, index) => (
            <tr key={`${datum.label}-${index}`}>
              <th scope="row">{datum.title ?? datum.label}</th>
              <td>
                {full.format(datum.value)} {valueLabel}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

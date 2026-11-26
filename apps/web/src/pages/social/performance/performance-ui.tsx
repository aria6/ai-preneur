import {
  AVAILABLE_SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORMS,
  type PerformanceAccountDto,
} from '@ai-preneur/shared';

import { cn } from '../../../lib/cn';
import { PLATFORM_SHORT } from '../components/PlatformChip';

const numberFormat = new Intl.NumberFormat('id-ID');
const percentFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

/** "1.234" or "—" when Instagram returned nothing. */
export function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : numberFormat.format(value);
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${percentFormat.format(value)}%`;
}

/** Milliseconds → "12,3 dtk" / "4 mnt 05 dtk". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const seconds = ms / 1000;
  if (seconds < 60) return `${percentFormat.format(seconds)} dtk`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} mnt ${String(Math.round(seconds % 60)).padStart(2, '0')} dtk`;
}

/** One line per platform: connected account, problem, not connected or "segera hadir". */
export function AccountStatusList({ accounts }: { accounts: readonly PerformanceAccountDto[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {SOCIAL_PLATFORMS.map((platform) => {
        const account = accounts.find((candidate) => candidate.platform === platform);
        const available = AVAILABLE_SOCIAL_PLATFORMS.includes(platform);
        const text = !available
          ? 'Segera hadir'
          : !account
            ? 'Belum terhubung'
            : account.status === 'error'
              ? `@${account.username ?? '—'} · perlu dihubungkan ulang`
              : `@${account.username ?? '—'}`;
        return (
          <li key={platform} className="flex items-center gap-2">
            <span
              className="inline-flex h-5 w-7 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600"
              title={SOCIAL_PLATFORM_LABELS[platform]}
            >
              {PLATFORM_SHORT[platform]}
            </span>
            <span
              className={cn(
                'truncate',
                account?.status === 'error'
                  ? 'text-red-600'
                  : account && available
                    ? 'text-slate-800'
                    : 'text-slate-400',
              )}
            >
              {text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

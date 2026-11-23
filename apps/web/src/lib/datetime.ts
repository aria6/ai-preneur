/**
 * Schedules are stored as UTC ISO strings and edited in the browser's local time
 * through `<input type="datetime-local">` (value format: YYYY-MM-DDTHH:mm).
 */
const pad = (value: number) => String(value).padStart(2, '0');

export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local datetime-input value → ISO string (UTC), or null when empty/invalid. */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Next full hour at least `minMinutes` from now, as a datetime-input value. */
export function suggestStart(minMinutes: number): string {
  const date = new Date(Date.now() + minMinutes * 60_000);
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return toDateTimeLocal(date.toISOString());
}

const scheduleFormatter = new Intl.DateTimeFormat('id-ID', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatSchedule(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : scheduleFormatter.format(date);
}

/** "dalam 2 jam", "3 hari lagi" … relative to `now`. */
export function relativeFromNow(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(diff)) return null;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const text =
    minutes < 60
      ? `${minutes} menit`
      : minutes < 60 * 48
        ? `${Math.round(minutes / 60)} jam`
        : `${Math.round(minutes / 1440)} hari`;
  return diff >= 0 ? `${text} lagi` : `${text} lalu`;
}

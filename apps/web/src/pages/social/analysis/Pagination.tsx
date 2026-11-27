import { Button } from '../../../components/ui/Button';
import { Icon } from '../../../components/ui/Icon';
import { formatMetric } from '../performance/performance-ui';

/** "1–50 dari 230" with previous / next. Hidden when everything fits on one page. */
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span className="tabular-nums">
        {formatMetric(from)}–{formatMetric(to)} dari {formatMetric(total)}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Halaman sebelumnya"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <Icon name="chevronLeft" className="size-4" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Halaman berikutnya"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <Icon name="chevronRight" className="size-4" />
        </Button>
      </div>
    </div>
  );
}

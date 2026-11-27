import type { BatchStatus } from '@ai-preneur/shared';

import { Badge } from '../../../components/ui/feedback';

const STATUS: Readonly<Record<BatchStatus, { label: string; color: 'gray' | 'violet' | 'green' }>> =
  {
    draft: { label: 'Draft', color: 'gray' },
    scheduled: { label: 'Terjadwal', color: 'violet' },
    completed: { label: 'Selesai', color: 'green' },
  };

export function BatchStatusBadge({
  status,
  archived = false,
}: {
  status: BatchStatus;
  /** Archived ideas show "Arsip" next to the status they keep. */
  archived?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge color={STATUS[status].color}>{STATUS[status].label}</Badge>
      {archived && <Badge color="gray">Arsip</Badge>}
    </span>
  );
}

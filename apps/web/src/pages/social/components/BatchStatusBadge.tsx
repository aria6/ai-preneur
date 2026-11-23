import type { BatchStatus } from '@ai-preneur/shared';

import { Badge } from '../../../components/ui/feedback';

const STATUS: Readonly<Record<BatchStatus, { label: string; color: 'gray' | 'violet' | 'green' }>> =
  {
    draft: { label: 'Draft', color: 'gray' },
    scheduled: { label: 'Terjadwal', color: 'violet' },
    completed: { label: 'Selesai', color: 'green' },
  };

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return <Badge color={STATUS[status].color}>{STATUS[status].label}</Badge>;
}

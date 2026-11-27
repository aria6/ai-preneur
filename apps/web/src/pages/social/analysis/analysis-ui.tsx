import type { CollectionRunDto, CollectionStage } from '@ai-preneur/shared';

import { Badge } from '../../../components/ui/feedback';
import { formatMetric } from '../performance/performance-ui';

export const STAGE_LABELS: Record<CollectionStage, string> = {
  posts: 'Membaca postingan',
  comments: 'Membaca komentar',
  dms: 'Membaca DM',
};

export const RUN_KIND_LABELS: Record<CollectionRunDto['kind'], string> = {
  initial: 'Ambil data',
  update: 'Perbarui data',
};

const ATTACHMENT_LABELS: Record<string, string> = {
  image: 'Gambar',
  video: 'Video',
  audio: 'Pesan suara',
  file: 'File',
  share: 'Postingan dibagikan',
  story: 'Story',
  unsupported: 'Tidak didukung Instagram API',
};

export function attachmentLabel(type: string): string {
  return ATTACHMENT_LABELS[type] ?? 'Lampiran';
}

export function RunStatusBadge({ run }: { run: CollectionRunDto }) {
  if (run.status === 'running') return <Badge color="violet">Berjalan</Badge>;
  if (run.status === 'failed') return <Badge color="red">Gagal</Badge>;
  return <Badge color={run.warnings.length > 0 ? 'amber' : 'green'}>Berhasil</Badge>;
}

/** "+3 komentar · +1 percakapan · +5 pesan" (zero values left out). */
export function runResultText(run: CollectionRunDto): string {
  const parts = [
    [run.newPosts, 'postingan'],
    [run.newComments, 'komentar'],
    [run.newConversations, 'percakapan'],
    [run.newMessages, 'pesan'],
  ] as const;
  const text = parts
    .filter(([value]) => value > 0)
    .map(([value, label]) => `+${formatMetric(value)} ${label}`)
    .join(' · ');
  return text || 'Tidak ada data baru';
}

/** Short post label: Publisher topic, else the start of the caption. */
export function postLabel(post: {
  caption: string;
  publisherItem: { topicNumber: number; partNumber: number | null; title: string } | null;
}): string {
  if (post.publisherItem) {
    const { topicNumber, partNumber, title } = post.publisherItem;
    return `Topik ${topicNumber}${partNumber ? ` part ${partNumber}` : ''} · ${title}`;
  }
  const caption = post.caption.replace(/\s+/g, ' ').trim();
  if (!caption) return 'Postingan tanpa caption';
  return caption.length > 60 ? `${caption.slice(0, 60)}…` : caption;
}

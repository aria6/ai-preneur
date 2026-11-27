import {
  DM_READABLE_MESSAGES,
  type DmConversationDetailResponse,
  type DmConversationPageDto,
} from '@ai-preneur/shared';
import { useEffect, useState } from 'react';

import { Alert, Badge, Card, EmptyState } from '../../../components/ui/feedback';
import { TextField } from '../../../components/ui/fields';
import { Spinner } from '../../../components/ui/Spinner';
import { useDebouncedValue } from '../../../hooks/use-debounced-value';
import { cn } from '../../../lib/cn';
import { errorMessage } from '../../../lib/errors';
import { formatDateTime } from '../../../lib/format';
import * as analysisService from '../../../services/social-analysis.service';
import { formatMetric } from '../performance/performance-ui';
import { attachmentLabel } from './analysis-ui';
import { Pagination } from './Pagination';

function Attachments({ types }: { types: readonly string[] }) {
  if (types.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {types.map((type) => (
        <span key={type} className="rounded bg-black/5 px-1.5 py-0.5 text-[11px]">
          📎 {attachmentLabel(type)}
        </span>
      ))}
    </span>
  );
}

function ConversationView({
  ideaId,
  conversationId,
  version,
}: {
  ideaId: string;
  conversationId: string;
  version: number;
}) {
  const [detail, setDetail] = useState<DmConversationDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    analysisService
      .getConversation(ideaId, conversationId, controller.signal)
      .then((result) => {
        setDetail(result);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [ideaId, conversationId, version]);

  if (error) return <Alert>{error}</Alert>;
  if (!detail || detail.conversation.id !== conversationId) {
    return (
      <div className="flex justify-center py-12 text-slate-400">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="font-medium text-slate-900">
          @{detail.conversation.participantUsername ?? 'tidak diketahui'}
        </p>
        <p className="text-xs text-slate-500">
          {formatMetric(detail.messages.length)} pesan tersimpan
        </p>
      </div>
      {detail.conversation.possiblyIncomplete && (
        <Alert variant="warning" className="m-3">
          Pesan yang lebih lama mungkin tidak lengkap: Instagram hanya memberi{' '}
          {DM_READABLE_MESSAGES} pesan terbaru per percakapan.
        </Alert>
      )}
      <ol className="flex-1 space-y-2 overflow-y-auto p-4">
        {detail.messages.map((message) => (
          <li
            key={message.id}
            className={cn('flex', message.isFromAccount ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                message.isFromAccount ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-800',
              )}
            >
              {message.text && <p className="break-words whitespace-pre-line">{message.text}</p>}
              <Attachments types={message.attachmentTypes} />
              {!message.text && message.attachmentTypes.length === 0 && (
                <p className="italic opacity-70">(pesan tanpa teks)</p>
              )}
              <p
                className={cn(
                  'mt-1 text-[11px]',
                  message.isFromAccount ? 'text-primary-100' : 'text-slate-500',
                )}
              >
                {formatDateTime(message.sentAt)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DmTab({
  ideaId,
  version,
  dmCollected,
}: {
  ideaId: string;
  version: number;
  dmCollected: boolean;
}) {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const [paging, setPaging] = useState({ key: q, page: 1 });
  const page = paging.key === q ? paging.page : 1;
  const [data, setData] = useState<DmConversationPageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    analysisService
      .listConversations(ideaId, { page, ...(q ? { q } : {}), signal: controller.signal })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [ideaId, page, q, version]);

  if (!dmCollected) {
    return (
      <EmptyState
        icon="search"
        title="DM belum diambil"
        description="DM diambil bersama komentar saat menekan tombol pengambilan. Bila gagal, alasannya tampil di atas (biasanya izin token)."
      />
    );
  }

  const activeId = selected ?? data?.items[0]?.id ?? null;
  return (
    <div className="space-y-4">
      <TextField
        label="Cari"
        placeholder="Username atau isi pesan"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="md:max-w-sm"
      />
      {error && <Alert>{error}</Alert>}
      {!data ? (
        <div className="flex justify-center py-12 text-slate-400">
          <Spinner className="size-6" />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon="search"
          title={q ? 'Tidak ada percakapan yang cocok' : 'Belum ada DM'}
          description={q ? 'Ubah pencarian.' : 'DM baru akan muncul setelah data diperbarui.'}
        />
      ) : (
        <Card className="grid overflow-hidden md:h-[36rem] md:grid-cols-[20rem_1fr]">
          <div className="flex min-h-0 flex-col border-b border-slate-100 md:border-r md:border-b-0">
            <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
              {data.items.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(conversation.id)}
                    aria-current={conversation.id === activeId || undefined}
                    className={cn(
                      'w-full px-4 py-3 text-left hover:bg-slate-50',
                      conversation.id === activeId && 'bg-primary-50 hover:bg-primary-50',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">
                        @{conversation.participantUsername ?? 'tidak diketahui'}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-500">
                        {formatDateTime(conversation.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-xs text-slate-600">
                      {conversation.lastMessage?.isFromAccount && 'Anda: '}
                      {conversation.lastMessage?.text ||
                        (conversation.lastMessage?.attachmentTypes[0]
                          ? attachmentLabel(conversation.lastMessage.attachmentTypes[0])
                          : '—')}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      {formatMetric(conversation.messageCount)} pesan
                      {conversation.possiblyIncomplete && (
                        <Badge color="amber">Tidak lengkap</Badge>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={(next) => setPaging({ key: q, page: next })}
            />
          </div>
          <div className="min-h-[24rem] min-w-0 md:min-h-0">
            {activeId && (
              <ConversationView ideaId={ideaId} conversationId={activeId} version={version} />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

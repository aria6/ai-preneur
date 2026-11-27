import type { CollectionRunDto } from '@ai-preneur/shared';
import { useEffect, useState } from 'react';

import { Alert, Card, EmptyState } from '../../../components/ui/feedback';
import { Spinner } from '../../../components/ui/Spinner';
import { errorMessage } from '../../../lib/errors';
import { formatDateTime } from '../../../lib/format';
import * as analysisService from '../../../services/social-analysis.service';
import { RUN_KIND_LABELS, RunStatusBadge, runResultText } from './analysis-ui';

export function RunsTab({
  ideaId,
  version,
  running,
}: {
  ideaId: string;
  version: number;
  running: boolean;
}) {
  const [runs, setRuns] = useState<CollectionRunDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    analysisService
      .listCollectionRuns(ideaId, controller.signal)
      .then((items) => {
        setRuns(items);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
    // `running` reloads the list when a collection starts.
  }, [ideaId, version, running]);

  if (error) return <Alert>{error}</Alert>;
  if (!runs) {
    return (
      <div className="flex justify-center py-12 text-slate-400">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (runs.length === 0) {
    return <EmptyState icon="refresh" title="Belum ada pengambilan data" />;
  }

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Mulai</th>
            <th className="px-4 py-2.5 font-medium">Jenis</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Hasil</th>
            <th className="px-4 py-2.5 font-medium">Catatan</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 align-top">
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                {formatDateTime(run.startedAt)}
                {run.finishedAt && (
                  <span className="block text-xs text-slate-400">
                    selesai {formatDateTime(run.finishedAt)}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                {RUN_KIND_LABELS[run.kind]}
              </td>
              <td className="px-4 py-3">
                <RunStatusBadge run={run} />
              </td>
              <td className="px-4 py-3 text-slate-700">{runResultText(run)}</td>
              <td className="max-w-md px-4 py-3 text-xs">
                {run.errorMessage && <p className="text-red-700">{run.errorMessage}</p>}
                {run.warnings.map((warning) => (
                  <p key={warning} className="text-amber-700">
                    {warning}
                  </p>
                ))}
                {!run.errorMessage && run.warnings.length === 0 && (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

import type { HealthResponse } from '@ai-preneur/shared';
import { useEffect, useState } from 'react';

import { fetchHealth } from '../services/health.service';

export type ApiHealthState =
  | { status: 'loading' }
  | { status: 'success'; data: HealthResponse }
  | { status: 'error'; message: string };

/** Fetches GET /api/health once on mount. Used to confirm frontend ↔ API wiring. */
export function useApiHealth(): ApiHealthState {
  const [state, setState] = useState<ApiHealthState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetchHealth(controller.signal)
      .then((data) => setState({ status: 'success', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    return () => controller.abort();
  }, []);

  return state;
}

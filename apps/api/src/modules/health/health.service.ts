import type { DatabaseClient } from '@ai-preneur/database';
import type { HealthResponse } from '@ai-preneur/shared';

export interface HealthService {
  check(): Promise<HealthResponse>;
}

export interface HealthServiceDeps {
  database: Pick<DatabaseClient, 'ping'>;
  /** Max time to wait for the database ping. Defaults to 2000 ms. */
  timeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createHealthService({ database, timeoutMs = 2_000 }: HealthServiceDeps): HealthService {
  return {
    async check() {
      const databaseUp = await withTimeout(database.ping(), timeoutMs).then(
        () => true,
        () => false,
      );

      return {
        status: databaseUp ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        checks: { database: databaseUp ? 'up' : 'down' },
      };
    },
  };
}

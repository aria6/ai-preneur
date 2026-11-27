import type { DatabaseClient } from '@ai-preneur/database';

import type { AppConfig } from '../config/env.js';
import type { Logger } from './logger.js';

/**
 * Everything the HTTP application needs, created once in server.ts
 * (the composition root) and passed down explicitly — no hidden singletons.
 * Module routers receive only the subset they actually use.
 */
export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  database: DatabaseClient;
  /**
   * Scheduled-upload worker of the Social Media AIgency (only `wake` is needed by
   * the HTTP side); null when SOCIAL_PUBLISHER_ENABLED=false.
   */
  socialPublisher: { wake(): void } | null;
  /** Bank Idea research worker; null when BANK_IDEA_WORKER_ENABLED=false. */
  bankIdeaWorker: { wake(): void; cancel(runId: string): boolean } | null;
}

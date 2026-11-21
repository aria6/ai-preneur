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
}

import { createDatabaseClient } from '@ai-preneur/database';

import { createApp } from './app.js';
import { loadConfig, loadEnvFile } from './config/env.js';
import { createLogger } from './core/logger.js';
import { createSocialPublisherWorker } from './modules/social-media/index.js';

/**
 * Composition root: the only place that reads the environment, creates
 * long-lived resources and wires them together. Migrations are NOT run here —
 * apply them explicitly with `pnpm db:migrate`.
 */
loadEnvFile();
const config = loadConfig();
const logger = createLogger(config.logLevel);

const database = createDatabaseClient({
  connectionString: config.database.url,
  maxConnections: config.database.poolMax,
  onError: (error) => logger.error('Idle database client error', { error }),
});

const app = createApp({ config, logger, database });

// Scheduled uploads (Social Media AIgency). Off by default until a platform publisher is ready.
const publisherWorker = config.social.publisherEnabled
  ? createSocialPublisherWorker({ db: database.db, logger, config: config.social })
  : null;
publisherWorker?.start();

const server = app.listen(config.server.port, config.server.host, (error?: Error) => {
  if (error) {
    logger.error('Failed to start HTTP server', { error });
    process.exit(1);
  }
  logger.info(`API listening on http://${config.server.host}:${config.server.port}`, {
    env: config.nodeEnv,
  });
});

let shuttingDown = false;

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Shutting down (${reason})`);

  const forceExit = setTimeout(() => {
    logger.error(`Graceful shutdown exceeded ${config.server.shutdownTimeoutMs} ms, forcing exit`);
    process.exit(1);
  }, config.server.shutdownTimeoutMs);
  forceExit.unref();

  try {
    // Stop accepting connections and wait for in-flight requests to finish.
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await publisherWorker?.stop();
    await database.close();
    logger.info('Shutdown complete');
    process.exit(exitCode);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  void shutdown('uncaughtException', 1);
});

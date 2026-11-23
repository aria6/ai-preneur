/**
 * Public API of the Social Media AIgency module.
 *
 * Today: Publisher AIgent (content queue from Google Drive, scheduling, accounts)
 * and its settings. Later: Intelligence AIgency (comments, DMs, engagement).
 */
import type { Database } from '@ai-preneur/database';
import type { Router } from 'express';

import type { Logger } from '../../core/logger.js';
import { createGoogleDriveClient } from './integrations/google-drive.client.js';
import { instagramPublisher } from './publishers/instagram.publisher.js';
import { createPublisherWorker, type PublisherWorker } from './publishers/publisher.worker.js';
import { createSocialRouter } from './routes/social.routes.js';
import { createCredentialsCipher, parseCredentialsKey } from './security/credentials-cipher.js';
import { createAccountsService } from './services/accounts.service.js';
import { createBatchesService } from './services/batches.service.js';
import { createItemsService } from './services/items.service.js';
import { createSettingsService } from './services/settings.service.js';

/** Settings the module needs, supplied by the composition root from AppConfig.social. */
export interface SocialMediaConfig {
  googleApiKey: string | null;
  credentialsKey: string | null;
  publisherIntervalMs: number;
}

interface SocialMediaDeps {
  db: Database;
  logger: Logger;
  config: SocialMediaConfig;
}

export function createSocialMediaRouter(deps: SocialMediaDeps): Router {
  const drive = createGoogleDriveClient(deps.config.googleApiKey);
  const cipher = createCredentialsCipher(parseCredentialsKey(deps.config.credentialsKey ?? undefined));
  const services = { db: deps.db, logger: deps.logger };

  return createSocialRouter({
    batches: createBatchesService({ ...services, drive }),
    items: createItemsService({ ...services, drive }),
    accounts: createAccountsService({ ...services, cipher }),
    settings: createSettingsService(services),
  });
}

/** Background uploader. Started by server.ts only when SOCIAL_PUBLISHER_ENABLED=true. */
export function createSocialPublisherWorker(deps: SocialMediaDeps): PublisherWorker {
  return createPublisherWorker({
    db: deps.db,
    logger: deps.logger,
    cipher: createCredentialsCipher(parseCredentialsKey(deps.config.credentialsKey ?? undefined)),
    intervalMs: deps.config.publisherIntervalMs,
    publishers: [instagramPublisher],
  });
}

export type { PublisherWorker } from './publishers/publisher.worker.js';

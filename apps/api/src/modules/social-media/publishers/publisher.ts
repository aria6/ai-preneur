import type { SocialPlatform } from '@ai-preneur/shared';

/** Everything a platform publisher needs to upload one queue row. */
export interface PublishJob {
  batchId: string;
  itemId: string;
  platform: SocialPlatform;
  title: string;
  caption: string;
  hashtags: string[];
  videoFileId: string;
  thumbnailFileId: string | null;
  /** Decrypted account credentials (shape defined by each platform). */
  credentials: unknown;
  /** Platform account ID the post goes to. */
  externalAccountId: string;
}

/**
 * Progress callbacks the worker persists, so a crashed attempt can be recovered
 * without risking a duplicate post.
 */
export interface PublishHooks {
  /** Aborts the attempt (overall timeout / shutdown). */
  signal: AbortSignal;
  /** The platform created its upload container. */
  onContainerCreated(containerId: string): Promise<void>;
  /** Called right before the final, irreversible "publish" request. */
  onPublishRequested(): Promise<void>;
}

export interface PublishResult {
  externalMediaId: string;
  /** Public link to the uploaded video (shown as the active platform icon). */
  externalUrl: string | null;
}

/** Outcome of checking a container left behind by a crashed attempt. */
export type RecoveryOutcome =
  { state: 'published'; result: PublishResult } | { state: 'not_published' } | { state: 'unknown' };

export interface PlatformPublisher {
  readonly platform: SocialPlatform;
  publish(job: PublishJob, hooks: PublishHooks): Promise<PublishResult>;
  /** Tells whether a container from an interrupted attempt ended up published. */
  recover(credentials: unknown, containerId: string): Promise<RecoveryOutcome>;
  /**
   * Extends a long-lived token (optional per platform). Throws PublishError with
   * `tokenInvalid` when the token is dead.
   */
  refreshCredentials?(credentials: unknown): Promise<{ credentials: unknown; expiresAt: Date }>;
}

/** Error whose message is safe to show to users in the row's status. */
export class PublishError extends Error {
  /** True when trying again later may succeed (network, rate limit, server error). */
  readonly retryable: boolean;
  /** True when the account's token no longer works (the account is flagged). */
  readonly tokenInvalid: boolean;
  constructor(message: string, options: { retryable?: boolean; tokenInvalid?: boolean } = {}) {
    super(message);
    this.name = 'PublishError';
    this.retryable = options.retryable ?? false;
    this.tokenInvalid = options.tokenInvalid ?? false;
  }
}

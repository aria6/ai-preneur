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
}

export interface PublishResult {
  externalMediaId: string;
  /** Public link to the uploaded video (shown as the active platform icon). */
  externalUrl: string | null;
}

export interface PlatformPublisher {
  readonly platform: SocialPlatform;
  publish(job: PublishJob): Promise<PublishResult>;
}

/** Error whose message is safe to show to users in the row's status. */
export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

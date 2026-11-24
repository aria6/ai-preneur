import type {
  SmAccountRow,
  SmBatchRow,
  SmPublicationRow,
  SmQueueItemRow,
} from '@ai-preneur/database';
import {
  SOCIAL_PLATFORMS,
  type BatchDetailDto,
  type BatchSummaryDto,
  type ItemLockReason,
  type PublicationDto,
  type QueueItemDto,
  type SocialAccountDto,
  type SocialPlatform,
  type SocialSettings,
} from '@ai-preneur/shared';

import type { BatchStats } from './repositories/batches.repository.js';

/** Explicit field-by-field mapping: encrypted credentials can never leak into a DTO. */

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export function batchPlatforms(batch: Pick<SmBatchRow, 'platforms'>): SocialPlatform[] {
  return batch.platforms.filter(isSocialPlatform);
}

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export function toBatchSummary(batch: SmBatchRow, stats: BatchStats | undefined): BatchSummaryDto {
  return {
    id: batch.id,
    title: batch.title,
    ideaNumber: batch.ideaNumber,
    driveFolderUrl: batch.driveFolderUrl,
    platforms: batchPlatforms(batch),
    status: batch.status,
    itemCount: stats?.itemCount ?? 0,
    publishedCount: stats?.publishedCount ?? 0,
    nextScheduledAt: iso(stats?.nextScheduledAt ?? null),
    confirmedAt: iso(batch.confirmedAt),
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}

function toPublicationDto(publication: SmPublicationRow): PublicationDto {
  return {
    platform: publication.platform,
    status: publication.status,
    externalUrl: publication.externalUrl,
    errorMessage: publication.errorMessage,
    warningMessage: publication.status === 'published' ? publication.warningMessage : null,
    publishedAt: iso(publication.publishedAt),
    attempts: publication.attempts,
    nextAttemptAt: publication.status === 'failed' ? iso(publication.nextAttemptAt) : null,
  };
}

export function toQueueItemDto(
  item: SmQueueItemRow,
  publications: readonly SmPublicationRow[],
  platforms: readonly SocialPlatform[],
  lockReason: ItemLockReason | null,
): QueueItemDto {
  return {
    id: item.id,
    position: item.position,
    topicNumber: item.topicNumber,
    partNumber: item.partNumber,
    title: item.title,
    videoFileId: item.videoFileId,
    videoFileName: item.videoFileName,
    thumbnailFileId: item.thumbnailFileId,
    thumbnailFileName: item.thumbnailFileName,
    caption: item.caption,
    hashtags: item.hashtags,
    scheduledAt: iso(item.scheduledAt),
    isPaused: item.isPaused,
    locked: lockReason !== null,
    lockReason,
    // Platforms not selected for this idea are never shown.
    publications: publications.filter((p) => platforms.includes(p.platform)).map(toPublicationDto),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toAccountDto(account: SmAccountRow): SocialAccountDto {
  return {
    platform: account.platform,
    username: account.username,
    externalAccountId: account.externalAccountId,
    accountType: account.accountType,
    status: account.status,
    lastError: account.lastError,
    lastCheckedAt: account.lastCheckedAt.toISOString(),
    connectedAt: account.createdAt.toISOString(),
  };
}

export function toBatchDetail(input: {
  batch: SmBatchRow;
  stats: BatchStats | undefined;
  items: QueueItemDto[];
  accounts: SmAccountRow[];
  settings: SocialSettings;
  now: Date;
}): BatchDetailDto {
  return {
    ...toBatchSummary(input.batch, input.stats),
    items: input.items,
    accounts: input.accounts.map(toAccountDto),
    settings: input.settings,
    serverTime: input.now.toISOString(),
  };
}

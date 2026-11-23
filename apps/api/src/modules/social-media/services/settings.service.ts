import type { Database } from '@ai-preneur/database';
import type { SocialSettings, UpdateSocialSettingsRequest } from '@ai-preneur/shared';

import type { Logger } from '../../../core/logger.js';
import type { AuthContext } from '../../iam/index.js';
import { createSettingsRepository } from '../repositories/settings.repository.js';

/** Social Media AIgency → Pengaturan. */
export function createSettingsService(deps: { db: Database; logger: Logger }) {
  const settings = createSettingsRepository(deps.db);

  return {
    get(): Promise<SocialSettings> {
      return settings.get();
    },

    async update(ctx: AuthContext, input: UpdateSocialSettingsRequest): Promise<SocialSettings> {
      await settings.save(input);
      deps.logger.info('Social Media AIgency settings updated', { actorId: ctx.user.id, ...input });
      return settings.get();
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;

import { eq, smSettings, type DatabaseExecutor } from '@ai-preneur/database';
import type { SocialSettings } from '@ai-preneur/shared';

export const DEFAULT_SOCIAL_SETTINGS: SocialSettings = {
  lockMinutes: 30,
  minConfirmLeadMinutes: 60,
};

export function createSettingsRepository(db: DatabaseExecutor) {
  return {
    async get(): Promise<SocialSettings> {
      const [row] = await db
        .select({
          lockMinutes: smSettings.lockMinutes,
          minConfirmLeadMinutes: smSettings.minConfirmLeadMinutes,
        })
        .from(smSettings)
        .where(eq(smSettings.id, 1))
        .limit(1);
      return row ?? DEFAULT_SOCIAL_SETTINGS;
    },

    async save(values: SocialSettings): Promise<void> {
      await db
        .insert(smSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: smSettings.id, set: values });
    },
  };
}

import { z } from 'zod';

/** Contract for `GET /api/health`. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  timestamp: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

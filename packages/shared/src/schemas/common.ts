import { z } from 'zod';

import { PERMISSIONS } from '../constants/permissions.js';

/** Trimmed, lower-cased, RFC-ish email. Emails are always stored in this normalized form. */
export const emailSchema = z
  .string({ error: 'Email wajib diisi' })
  .trim()
  .toLowerCase()
  .min(1, 'Email wajib diisi')
  .max(254, 'Email maksimal 254 karakter')
  .pipe(z.email('Format email tidak valid'));

/**
 * New-password policy (NIST SP 800-63B style): length over composition rules.
 * The upper bound also caps hashing cost per request.
 */
export const passwordSchema = z
  .string({ error: 'Password wajib diisi' })
  .min(8, 'Password minimal 8 karakter')
  .max(128, 'Password maksimal 128 karakter');

export const personNameSchema = z
  .string({ error: 'Nama wajib diisi' })
  .trim()
  .min(1, 'Nama wajib diisi')
  .max(100, 'Nama maksimal 100 karakter');

export const uuidSchema = z.uuid('ID tidak valid');

export const idParamsSchema = z.object({ id: uuidSchema });

export const permissionSchema = z.enum(PERMISSIONS, { error: 'Hak akses tidak dikenal' });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const roleSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
});

export type RoleSummary = z.infer<typeof roleSummarySchema>;

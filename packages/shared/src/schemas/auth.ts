import { z } from 'zod';

import {
  emailSchema,
  passwordSchema,
  permissionSchema,
  personNameSchema,
  roleSummarySchema,
} from './common.js';

// ---- Login ---------------------------------------------------------------------

export const loginRequestSchema = z.object({
  email: emailSchema,
  // Existing passwords are not re-validated against the policy, only bounded.
  password: z
    .string({ error: 'Password wajib diisi' })
    .min(1, 'Password wajib diisi')
    .max(128, 'Password maksimal 128 karakter'),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// ---- Current user --------------------------------------------------------------

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleSummarySchema,
  /** Effective permissions (all permissions for a system role). */
  permissions: z.array(permissionSchema),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** Response of POST /auth/login, GET /auth/me and PATCH /profile. */
export const authUserResponseSchema = z.object({ user: authUserSchema });
export type AuthUserResponse = z.infer<typeof authUserResponseSchema>;

// ---- Profile -------------------------------------------------------------------

export const updateProfileRequestSchema = z.object({
  name: personNameSchema,
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z
      .string({ error: 'Password saat ini wajib diisi' })
      .min(1, 'Password saat ini wajib diisi')
      .max(128, 'Password maksimal 128 karakter'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'Password baru harus berbeda dari password saat ini',
    path: ['newPassword'],
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

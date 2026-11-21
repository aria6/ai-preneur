import { z } from 'zod';

import { permissionSchema } from './common.js';

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** System roles (Super Admin) implicitly hold every permission and cannot be edited. */
  isSystem: z.boolean(),
  permissions: z.array(permissionSchema),
  userCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RoleDto = z.infer<typeof roleSchema>;

export const roleListResponseSchema = z.object({ items: z.array(roleSchema) });
export type RoleListResponse = z.infer<typeof roleListResponseSchema>;

export const roleResponseSchema = z.object({ role: roleSchema });
export type RoleResponse = z.infer<typeof roleResponseSchema>;

const roleNameSchema = z
  .string({ error: 'Nama role wajib diisi' })
  .trim()
  .min(2, 'Nama role minimal 2 karakter')
  .max(100, 'Nama role maksimal 100 karakter');

const roleDescriptionSchema = z
  .string()
  .trim()
  .max(500, 'Deskripsi maksimal 500 karakter')
  .transform((value) => (value === '' ? null : value))
  .nullable();

const rolePermissionsSchema = z
  .array(permissionSchema)
  .max(200)
  .transform((permissions) => [...new Set(permissions)]);

export const createRoleRequestSchema = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema.optional(),
  permissions: rolePermissionsSchema,
});
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

export const updateRoleRequestSchema = z
  .object({
    name: roleNameSchema.optional(),
    description: roleDescriptionSchema.optional(),
    permissions: rolePermissionsSchema.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Tidak ada perubahan yang dikirim',
  });
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

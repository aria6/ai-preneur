import { z } from 'zod';

import {
  emailSchema,
  paginationQuerySchema,
  passwordSchema,
  personNameSchema,
  roleSummarySchema,
  uuidSchema,
} from './common.js';

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  role: roleSummarySchema,
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserDto = z.infer<typeof userSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const userListResponseSchema = z.object({
  items: z.array(userSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const userResponseSchema = z.object({ user: userSchema });
export type UserResponse = z.infer<typeof userResponseSchema>;

export const createUserRequestSchema = z.object({
  email: emailSchema,
  name: personNameSchema,
  password: passwordSchema,
  roleId: uuidSchema,
  isActive: z.boolean().default(true),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .object({
    name: personNameSchema.optional(),
    roleId: uuidSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Tidak ada perubahan yang dikirim',
  });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const resetUserPasswordRequestSchema = z.object({
  newPassword: passwordSchema,
});
export type ResetUserPasswordRequest = z.infer<typeof resetUserPasswordRequestSchema>;

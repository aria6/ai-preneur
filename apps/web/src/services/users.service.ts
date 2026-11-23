import {
  userListResponseSchema,
  userResponseSchema,
  type CreateUserRequest,
  type ResetUserPasswordRequest,
  type UpdateUserRequest,
  type UserDto,
  type UserListResponse,
} from '@ai-preneur/shared';

import { apiClient } from './api-client';

export function listUsers(
  params: { page: number; pageSize: number; search?: string },
  signal?: AbortSignal,
): Promise<UserListResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) query.set('search', params.search);
  return apiClient.get(`/users?${query.toString()}`, {
    schema: userListResponseSchema,
    signal: signal ?? null,
  });
}

export async function createUser(input: CreateUserRequest): Promise<UserDto> {
  return (await apiClient.post('/users', { body: input, schema: userResponseSchema })).user;
}

export async function updateUser(id: string, input: UpdateUserRequest): Promise<UserDto> {
  return (
    await apiClient.patch(`/users/${encodeURIComponent(id)}`, {
      body: input,
      schema: userResponseSchema,
    })
  ).user;
}

export async function resetUserPassword(
  id: string,
  input: ResetUserPasswordRequest,
): Promise<void> {
  await apiClient.put(`/users/${encodeURIComponent(id)}/password`, { body: input });
}

export async function deleteUser(id: string): Promise<void> {
  await apiClient.delete(`/users/${encodeURIComponent(id)}`);
}

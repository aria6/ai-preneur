import {
  roleListResponseSchema,
  roleResponseSchema,
  type CreateRoleRequest,
  type RoleDto,
  type UpdateRoleRequest,
} from '@ai-preneur/shared';

import { apiClient } from './api-client';

export async function listRoles(signal?: AbortSignal): Promise<RoleDto[]> {
  return (await apiClient.get('/roles', { schema: roleListResponseSchema, signal: signal ?? null }))
    .items;
}

export async function createRole(input: CreateRoleRequest): Promise<RoleDto> {
  return (await apiClient.post('/roles', { body: input, schema: roleResponseSchema })).role;
}

export async function updateRole(id: string, input: UpdateRoleRequest): Promise<RoleDto> {
  return (
    await apiClient.patch(`/roles/${encodeURIComponent(id)}`, {
      body: input,
      schema: roleResponseSchema,
    })
  ).role;
}

export async function deleteRole(id: string): Promise<void> {
  await apiClient.delete(`/roles/${encodeURIComponent(id)}`);
}

import {
  authUserResponseSchema,
  type AuthUser,
  type ChangePasswordRequest,
  type LoginRequest,
  type UpdateProfileRequest,
} from '@ai-preneur/shared';

import { apiClient } from './api-client';

export async function login(input: LoginRequest): Promise<AuthUser> {
  const { user } = await apiClient.post('/auth/login', {
    body: input,
    schema: authUserResponseSchema,
  });
  return user;
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

export async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser> {
  const { user } = await apiClient.get('/auth/me', {
    schema: authUserResponseSchema,
    signal: signal ?? null,
  });
  return user;
}

export async function updateProfile(input: UpdateProfileRequest): Promise<AuthUser> {
  const { user } = await apiClient.patch('/profile', {
    body: input,
    schema: authUserResponseSchema,
  });
  return user;
}

export async function changePassword(input: ChangePasswordRequest): Promise<void> {
  await apiClient.put('/profile/password', { body: input });
}

import {
  createUserRequestSchema,
  idParamsSchema,
  listUsersQuerySchema,
  PERMISSIONS,
  resetUserPasswordRequestSchema,
  updateUserRequestSchema,
  type UserListResponse,
  type UserResponse,
} from '@ai-preneur/shared';
import express, { type Router } from 'express';

import { sendNoContent, sendSuccess } from '../../../core/http.js';
import { parseInput } from '../../../core/validation.js';
import { requireAuthContext } from '../auth-context.js';
import { requirePermission } from '../iam.middleware.js';
import type { UsersService } from '../services/users.service.js';

/**
 * GET    /users               users.view
 * GET    /users/:id           users.view
 * POST   /users               users.create
 * PATCH  /users/:id           users.update
 * PUT    /users/:id/password  users.update
 * DELETE /users/:id           users.delete
 */
export function createUsersRouter(deps: { users: UsersService }): Router {
  const { users } = deps;
  const router = express.Router();

  router.get('/', requirePermission(PERMISSIONS.USERS_VIEW), async (req, res) => {
    const query = parseInput(listUsersQuerySchema, req.query);
    sendSuccess<UserListResponse>(res, await users.list(query));
  });

  router.get('/:id', requirePermission(PERMISSIONS.USERS_VIEW), async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess<UserResponse>(res, { user: await users.get(id) });
  });

  router.post('/', requirePermission(PERMISSIONS.USERS_CREATE), async (req, res) => {
    const input = parseInput(createUserRequestSchema, req.body);
    const user = await users.create(requireAuthContext(req), input);
    sendSuccess<UserResponse>(res, { user }, 201);
  });

  router.patch('/:id', requirePermission(PERMISSIONS.USERS_UPDATE), async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const input = parseInput(updateUserRequestSchema, req.body);
    const user = await users.update(requireAuthContext(req), id, input);
    sendSuccess<UserResponse>(res, { user });
  });

  router.put('/:id/password', requirePermission(PERMISSIONS.USERS_UPDATE), async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const input = parseInput(resetUserPasswordRequestSchema, req.body);
    await users.resetPassword(requireAuthContext(req), id, input);
    sendNoContent(res);
  });

  router.delete('/:id', requirePermission(PERMISSIONS.USERS_DELETE), async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    await users.delete(requireAuthContext(req), id);
    sendNoContent(res);
  });

  return router;
}

import {
  createRoleRequestSchema,
  idParamsSchema,
  PERMISSIONS,
  updateRoleRequestSchema,
  type RoleListResponse,
  type RoleResponse,
} from '@ai-preneur/shared';
import express, { type Router } from 'express';

import { sendNoContent, sendSuccess } from '../../../core/http.js';
import { parseInput } from '../../../core/validation.js';
import { requireAuthContext } from '../auth-context.js';
import { requireAnyPermission, requirePermission } from '../iam.middleware.js';
import type { RolesService } from '../services/roles.service.js';

/**
 * GET    /roles      roles.view | users.create | users.update  (role picker in user forms)
 * GET    /roles/:id  roles.view
 * POST   /roles      roles.manage
 * PATCH  /roles/:id  roles.manage
 * DELETE /roles/:id  roles.manage
 */
export function createRolesRouter(deps: { roles: RolesService }): Router {
  const { roles } = deps;
  const router = express.Router();

  router.get(
    '/',
    requireAnyPermission(
      PERMISSIONS.ROLES_VIEW,
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.USERS_UPDATE,
    ),
    async (_req, res) => {
      sendSuccess<RoleListResponse>(res, { items: await roles.list() });
    },
  );

  router.get('/:id', requirePermission(PERMISSIONS.ROLES_VIEW), async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess<RoleResponse>(res, { role: await roles.get(id) });
  });

  router.post('/', requirePermission(PERMISSIONS.ROLES_MANAGE), async (req, res) => {
    const input = parseInput(createRoleRequestSchema, req.body);
    const role = await roles.create(requireAuthContext(req), input);
    sendSuccess<RoleResponse>(res, { role }, 201);
  });

  router.patch('/:id', requirePermission(PERMISSIONS.ROLES_MANAGE), async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const input = parseInput(updateRoleRequestSchema, req.body);
    const role = await roles.update(requireAuthContext(req), id, input);
    sendSuccess<RoleResponse>(res, { role });
  });

  router.delete('/:id', requirePermission(PERMISSIONS.ROLES_MANAGE), async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    await roles.delete(requireAuthContext(req), id);
    sendNoContent(res);
  });

  return router;
}

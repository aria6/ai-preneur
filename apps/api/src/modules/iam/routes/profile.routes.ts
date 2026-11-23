import {
  changePasswordRequestSchema,
  updateProfileRequestSchema,
  type AuthUserResponse,
} from '@ai-preneur/shared';
import express, { type Router } from 'express';

import { sendSuccess } from '../../../core/http.js';
import { parseInput } from '../../../core/validation.js';
import { requireAuthContext } from '../auth-context.js';
import { requireAuth } from '../iam.middleware.js';
import { setSessionCookie, type SessionCookieConfig } from '../security/session-cookie.js';
import type { ProfileService } from '../services/profile.service.js';
import { clientInfo } from './auth.routes.js';

/**
 * PATCH /profile           — update own name.
 * PUT   /profile/password  — change own password (requires current password).
 */
export function createProfileRouter(deps: {
  profile: ProfileService;
  cookie: SessionCookieConfig;
}): Router {
  const { profile, cookie } = deps;
  const router = express.Router();

  router.use(requireAuth);

  router.patch('/', async (req, res) => {
    const input = parseInput(updateProfileRequestSchema, req.body);
    const user = await profile.updateProfile(requireAuthContext(req), input);
    sendSuccess<AuthUserResponse>(res, { user });
  });

  router.put('/password', async (req, res) => {
    const input = parseInput(changePasswordRequestSchema, req.body);
    const token = await profile.changePassword(requireAuthContext(req), input, clientInfo(req));
    setSessionCookie(res, cookie, token);
    sendSuccess(res, null);
  });

  return router;
}

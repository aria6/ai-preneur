import { loginRequestSchema, type AuthUserResponse } from '@ai-preneur/shared';
import express, { type Request, type Router } from 'express';

import { sendSuccess } from '../../../core/http.js';
import { parseInput } from '../../../core/validation.js';
import { getAuthContext, requireAuthContext } from '../auth-context.js';
import { toAuthUser } from '../iam.mappers.js';
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
  type SessionCookieConfig,
} from '../security/session-cookie.js';
import type { AuthService, ClientInfo } from '../services/auth.service.js';

export function clientInfo(req: Request): ClientInfo {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

/**
 * POST /auth/login   — public. Sets the HttpOnly session cookie.
 * POST /auth/logout  — revokes the current session (idempotent).
 * GET  /auth/me      — current user, or 401.
 */
export function createAuthRouter(deps: { auth: AuthService; cookie: SessionCookieConfig }): Router {
  const { auth, cookie } = deps;
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const input = parseInput(loginRequestSchema, req.body);

    // Logging in while holding another session: revoke the old one first.
    const previous = getAuthContext(req);
    if (previous) await auth.logout(previous.sessionId);

    const { token, user } = await auth.login(input, clientInfo(req));
    setSessionCookie(res, cookie, token);
    sendSuccess<AuthUserResponse>(res, { user });
  });

  router.post('/logout', async (req, res) => {
    const ctx = getAuthContext(req);
    if (ctx) {
      await auth.logout(ctx.sessionId);
    } else {
      const token = readSessionCookie(req, cookie);
      if (token) await auth.revokeToken(token);
    }
    clearSessionCookie(res, cookie);
    sendSuccess(res, null);
  });

  router.get('/me', (req, res) => {
    const ctx = requireAuthContext(req);
    sendSuccess<AuthUserResponse>(res, { user: toAuthUser(ctx) });
  });

  return router;
}

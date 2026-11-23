import type { Permission } from '@ai-preneur/shared';
import type { RequestHandler } from 'express';

import { forbidden } from '../../core/errors.js';
import { hasPermission } from './access-policy.js';
import { requireAuthContext, setAuthContext } from './auth-context.js';
import {
  clearSessionCookie,
  readSessionCookie,
  type SessionCookieConfig,
} from './security/session-cookie.js';
import type { AuthService } from './services/auth.service.js';

/**
 * Resolves the session cookie (if any) into an AuthContext. Never rejects a
 * request by itself — route-level guards decide. Invalid cookies are cleared.
 */
export function createAuthenticate(auth: AuthService, cookie: SessionCookieConfig): RequestHandler {
  return async (req, res, next) => {
    const token = readSessionCookie(req, cookie);
    if (!token) {
      next();
      return;
    }
    const ctx = await auth.resolveSession(token);
    if (ctx) setAuthContext(req, ctx);
    else clearSessionCookie(res, cookie);
    next();
  };
}

/** 401 unless the request carries a valid session. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  requireAuthContext(req);
  next();
};

/** 401 if unauthenticated, 403 unless the user holds ALL given permissions. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const ctx = requireAuthContext(req);
    if (!permissions.every((permission) => hasPermission(ctx, permission))) throw forbidden();
    next();
  };
}

/** 401 if unauthenticated, 403 unless the user holds AT LEAST ONE of the given permissions. */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const ctx = requireAuthContext(req);
    if (!permissions.some((permission) => hasPermission(ctx, permission))) throw forbidden();
    next();
  };
}

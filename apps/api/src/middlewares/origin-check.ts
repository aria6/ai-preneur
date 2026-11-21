import type { Request, RequestHandler } from 'express';

import { forbidden } from '../core/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function hasCookie(req: Request, name: string): boolean {
  const header = req.headers.cookie;
  if (!header) return false;
  return header.split(';').some((part) => part.trim().startsWith(`${name}=`));
}

/**
 * CSRF defence for cookie-authenticated requests (in addition to SameSite=Strict).
 *
 * State-changing requests must come from an allowed origin (CORS_ORIGIN) or the
 * API's own origin. Requests without Origin/Referer are only accepted when they
 * carry no session cookie — i.e. they have no ambient authority to abuse.
 */
export function createOriginCheck(options: {
  allowedOrigins: readonly string[];
  sessionCookieName: string;
}): RequestHandler {
  const allowed = new Set(options.allowedOrigins);

  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.get('origin') ?? refererOrigin(req.get('referer'));

    if (origin) {
      const ownOrigin = `${req.protocol}://${req.get('host') ?? ''}`;
      if (allowed.has(origin) || origin === ownOrigin) {
        next();
        return;
      }
      next(forbidden('Permintaan ditolak: origin tidak diizinkan.'));
      return;
    }

    if (hasCookie(req, options.sessionCookieName)) {
      next(forbidden('Permintaan ditolak: origin tidak diketahui.'));
      return;
    }

    next();
  };
}

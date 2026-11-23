/**
 * Public API of the IAM (Identity & Access Management) module:
 * authentication, sessions, profile, users, roles and permissions.
 *
 * Other modules protect their routes with `requireAuth` / `requirePermission`
 * and read the caller with `requireAuthContext(req)`.
 */
import type { Database } from '@ai-preneur/database';
import type { RequestHandler, Router } from 'express';

import type { Logger } from '../../core/logger.js';
import type { IamConfig } from './iam.config.js';
import { createAuthenticate } from './iam.middleware.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createProfileRouter } from './routes/profile.routes.js';
import { createRolesRouter } from './routes/roles.routes.js';
import { createUsersRouter } from './routes/users.routes.js';
import type { SessionCookieConfig } from './security/session-cookie.js';
import { createAuthService } from './services/auth.service.js';
import { createProfileService } from './services/profile.service.js';
import { createRolesService } from './services/roles.service.js';
import { createUsersService } from './services/users.service.js';

export interface IamModule {
  /** Global middleware: attaches the AuthContext when a valid session cookie is present. */
  authenticate: RequestHandler;
  routers: { auth: Router; profile: Router; users: Router; roles: Router };
}

export function createIamModule(deps: {
  db: Database;
  logger: Logger;
  config: IamConfig;
}): IamModule {
  const cookie: SessionCookieConfig = {
    name: deps.config.cookieName,
    secure: deps.config.cookieSecure,
    maxAgeMs: deps.config.sessionTtlHours * 60 * 60 * 1000,
  };

  const auth = createAuthService(deps);
  const profile = createProfileService(deps);
  const users = createUsersService(deps);
  const roles = createRolesService(deps);

  return {
    authenticate: createAuthenticate(auth, cookie),
    routers: {
      auth: createAuthRouter({ auth, cookie }),
      profile: createProfileRouter({ profile, cookie }),
      users: createUsersRouter({ users }),
      roles: createRolesRouter({ roles }),
    },
  };
}

export type { AuthContext, AuthenticatedUser } from './access-policy.js';
export { getAuthContext, requireAuthContext } from './auth-context.js';
export type { IamConfig } from './iam.config.js';
export { requireAnyPermission, requireAuth, requirePermission } from './iam.middleware.js';
export { hashPassword } from './security/password.js';

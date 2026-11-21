import type { Request } from 'express';

import { unauthorized } from '../../core/errors.js';
import type { AuthContext } from './access-policy.js';

/**
 * Per-request authentication state, keyed by the request object.
 * A WeakMap keeps this typed without augmenting Express globals, and entries
 * disappear with the request.
 */
const contexts = new WeakMap<Request, AuthContext>();

export function setAuthContext(req: Request, ctx: AuthContext): void {
  contexts.set(req, ctx);
}

export function getAuthContext(req: Request): AuthContext | undefined {
  return contexts.get(req);
}

/** Returns the authenticated context or throws 401. */
export function requireAuthContext(req: Request): AuthContext {
  const ctx = contexts.get(req);
  if (!ctx) throw unauthorized('Anda harus masuk terlebih dahulu.');
  return ctx;
}

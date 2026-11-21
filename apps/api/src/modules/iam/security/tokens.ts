import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random token, base64url → always 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isWellFormedSessionToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Only the SHA-256 of a session token is stored, so a database leak does not
 * yield usable session cookies. (A fast hash is fine: the token is 256-bit random.)
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

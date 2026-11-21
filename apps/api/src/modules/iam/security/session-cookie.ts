import type { CookieOptions, Request, Response } from 'express';

export interface SessionCookieConfig {
  name: string;
  secure: boolean;
  maxAgeMs: number;
}

function baseOptions(config: SessionCookieConfig): CookieOptions {
  return {
    httpOnly: true, // not readable by JavaScript → not stealable through XSS
    secure: config.secure,
    sameSite: 'strict', // never sent on cross-site requests → CSRF protection
    path: '/',
  };
}

export function readSessionCookie(req: Request, config: SessionCookieConfig): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== config.name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function setSessionCookie(res: Response, config: SessionCookieConfig, token: string): void {
  res.cookie(config.name, token, { ...baseOptions(config), maxAge: config.maxAgeMs });
}

export function clearSessionCookie(res: Response, config: SessionCookieConfig): void {
  res.clearCookie(config.name, baseOptions(config));
}

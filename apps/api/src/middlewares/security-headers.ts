import type { RequestHandler } from 'express';

/**
 * Security headers for a JSON-only API (dependency-free subset of helmet).
 * The API never serves HTML, so the CSP forbids everything.
 */
export function createSecurityHeaders(options: { hsts: boolean }): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Responses may contain personal data: never cache them anywhere.
    res.setHeader('Cache-Control', 'no-store');
    if (options.hsts) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

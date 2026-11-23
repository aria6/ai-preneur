import type { RequestHandler } from 'express';

import { clientRateKey } from '../core/client-ip.js';
import { tooManyRequests } from '../core/errors.js';

interface Counter {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per key per window. */
  max: number;
  /** Message returned on 429. */
  message?: string;
  /** Key function; defaults to the client IP (IPv6 grouped by /64). */
  key?: (ip: string | undefined) => string;
}

/**
 * Fixed-window rate limiter, in-memory and dependency-free. Guards the expensive
 * auth endpoints (password hashing) against bursts BEFORE the hash runs — a layer
 * in front of the durable, per-outcome DB throttle.
 *
 * In-memory means per-instance: correct for the single-instance deployment this
 * project targets. Behind several instances or as a hard DoS control, add
 * rate limiting at the reverse proxy as well. Counts every request (not only
 * failures), so it also blunts credential-stuffing bursts.
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const {
    windowMs,
    max,
    message = 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
  } = options;
  const keyOf = options.key ?? clientRateKey;
  const counters = new Map<string, Counter>();
  let nextSweep = Date.now() + windowMs;

  /** Drop expired counters so the map cannot grow without bound. */
  function sweep(now: number): void {
    if (now < nextSweep) return;
    for (const [key, counter] of counters) {
      if (counter.resetAt <= now) counters.delete(key);
    }
    nextSweep = now + windowMs;
    // Last-resort cap against a flood of distinct keys (e.g. spoofed XFF).
    if (counters.size > 50_000) counters.clear();
  }

  return (req, _res, next) => {
    const now = Date.now();
    sweep(now);

    const key = keyOf(req.ip);
    const existing = counters.get(key);

    if (!existing || existing.resetAt <= now) {
      counters.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > max) {
      next(tooManyRequests(message, (existing.resetAt - now) / 1000));
      return;
    }
    next();
  };
}

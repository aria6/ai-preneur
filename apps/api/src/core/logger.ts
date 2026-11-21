export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogMeta = Record<string, unknown>;

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Error objects serialize to `{}` with JSON.stringify; expand them explicitly. */
function serialize(meta: LogMeta): string {
  return JSON.stringify(meta, (_key, value: unknown) =>
    value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause }
      : value,
  );
}

/**
 * Minimal structured logger writing single-line entries to stdout/stderr.
 * Intentionally dependency-free; swap for pino or similar behind this
 * interface if/when log shipping is needed.
 */
export function createLogger(minLevel: LogLevel = 'info'): Logger {
  const threshold = LEVEL_WEIGHT[minLevel];

  const write = (level: LogLevel, message: string, meta?: LogMeta): void => {
    if (LEVEL_WEIGHT[level] < threshold) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${
      meta && Object.keys(meta).length > 0 ? ` ${serialize(meta)}` : ''
    }`;
    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

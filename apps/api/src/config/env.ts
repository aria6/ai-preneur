import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Repo-root `.env`. `src/config` and `dist/config` sit at the same depth,
 * so this path is valid both under `tsx` (dev) and `node dist` (prod).
 */
const ROOT_ENV_FILE = resolve(import.meta.dirname, '../../../../.env');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('localhost'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgres:// or postgresql://'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  server: { host: string; port: number; shutdownTimeoutMs: number };
  cors: { origins: string[] };
  database: { url: string; poolMax: number };
}

/**
 * Loads the repo-root `.env` into `process.env`.
 * Variables already set in the real environment always win.
 */
export function loadEnvFile(path: string = ROOT_ENV_FILE): void {
  loadDotenv({ path, quiet: true });
}

/**
 * Validates environment variables and returns a typed, immutable config.
 * Throws with a readable list of problems so the process fails fast at startup.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const env = parsed.data;

  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    logLevel: env.LOG_LEVEL,
    server: {
      host: env.API_HOST,
      port: env.API_PORT,
      shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    },
    cors: {
      origins: env.CORS_ORIGIN.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    },
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
    },
  });
}

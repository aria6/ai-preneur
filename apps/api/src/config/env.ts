import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Repo-root `.env`. `src/config` and `dist/config` sit at the same depth,
 * so this path is valid both under `tsx` (dev) and `node dist` (prod).
 */
const ROOT_ENV_FILE = resolve(import.meta.dirname, '../../../../.env');

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('localhost'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /** Express "trust proxy": false | true | hop count | comma-separated subnets. */
  TRUST_PROXY: z.string().default('false'),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgres:// or postgresql://'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(24 * 7),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(60 * 24 * 30)
    .default(60 * 24),
  /** Defaults to true in production. Must be true whenever the site is served over HTTPS. */
  SESSION_COOKIE_SECURE: booleanString.optional(),
  /** Google API key used to read publicly shared Drive folders (Social Media AIgency). */
  GOOGLE_API_KEY: z.string().trim().optional(),
  /** 32-byte base64 key encrypting social media tokens: `openssl rand -base64 32`. */
  SOCIAL_CREDENTIALS_KEY: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || Buffer.from(value, 'base64').length === 32, {
      message: 'SOCIAL_CREDENTIALS_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)',
    }),
  /** Runs the scheduled-upload worker (real uploads to Instagram at each row's schedule). */
  SOCIAL_PUBLISHER_ENABLED: booleanString.default(false),
  SOCIAL_PUBLISHER_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(30),
});

export interface AuthConfig {
  sessionTtlHours: number;
  sessionIdleTimeoutMinutes: number;
  cookieName: string;
  cookieSecure: boolean;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  server: {
    host: string;
    port: number;
    shutdownTimeoutMs: number;
    trustProxy: boolean | number | string;
  };
  cors: { origins: string[] };
  database: { url: string; poolMax: number };
  auth: AuthConfig;
  social: SocialConfig;
}

export interface SocialConfig {
  googleApiKey: string | null;
  credentialsKey: string | null;
  publisherEnabled: boolean;
  publisherIntervalMs: number;
}

/**
 * Loads the repo-root `.env` into `process.env`.
 * Variables already set in the real environment always win.
 */
export function loadEnvFile(path: string = ROOT_ENV_FILE): void {
  loadDotenv({ path, quiet: true });
}

function parseTrustProxy(value: string): boolean | number | string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'false' || normalized === '') return false;
  if (normalized === 'true') return true;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value.trim();
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
  const isProduction = env.NODE_ENV === 'production';
  const cookieSecure = env.SESSION_COOKIE_SECURE ?? isProduction;

  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    isProduction,
    logLevel: env.LOG_LEVEL,
    server: {
      host: env.API_HOST,
      port: env.API_PORT,
      shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
      trustProxy: parseTrustProxy(env.TRUST_PROXY),
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
    auth: {
      sessionTtlHours: env.SESSION_TTL_HOURS,
      sessionIdleTimeoutMinutes: env.SESSION_IDLE_TIMEOUT_MINUTES,
      // `__Host-` binds the cookie to this exact host, HTTPS-only, path `/`.
      cookieName: cookieSecure ? '__Host-aip_session' : 'aip_session',
      cookieSecure,
    },
    social: {
      googleApiKey: env.GOOGLE_API_KEY || null,
      credentialsKey: env.SOCIAL_CREDENTIALS_KEY || null,
      publisherEnabled: env.SOCIAL_PUBLISHER_ENABLED,
      publisherIntervalMs: env.SOCIAL_PUBLISHER_INTERVAL_SECONDS * 1000,
    },
  });
}

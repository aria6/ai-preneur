/**
 * Centralized, validated access to client-side environment variables.
 * Import `env` instead of reading `import.meta.env` throughout the app.
 */
function required(name: keyof ImportMetaEnv, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env at the repository root.`,
    );
  }
  return value;
}

export const env = Object.freeze({
  /** Base URL of the API including the `/api` prefix, without a trailing slash. */
  apiBaseUrl: required('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL).replace(/\/+$/, ''),
  isDev: import.meta.env.DEV,
});

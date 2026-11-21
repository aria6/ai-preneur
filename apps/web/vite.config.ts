import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const ENV_DIR = '../..';

export default defineConfig(({ mode }) => {
  // Reads non-VITE_ variables for the dev server only; they never reach the bundle.
  const env = loadEnv(mode, ENV_DIR, '');
  const apiProxyTarget = env.API_PROXY_TARGET || 'http://localhost:3000';

  return {
    plugins: [react(), tailwindcss()],
    // Single repo-root .env. Only VITE_-prefixed variables are exposed to client code.
    envDir: ENV_DIR,
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin /api in development → first-party, SameSite=Strict session cookie.
      proxy: {
        '/api': { target: apiProxyTarget, changeOrigin: true },
      },
    },
    preview: {
      port: 4173,
      proxy: {
        '/api': { target: apiProxyTarget, changeOrigin: true },
      },
    },
    build: {
      sourcemap: true,
    },
  };
});

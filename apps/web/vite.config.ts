import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read the single repo-root .env. Vite only exposes VITE_-prefixed variables
  // to client code, so backend secrets in the same file never reach the bundle.
  envDir: '../..',
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
  },
  build: {
    sourcemap: true,
  },
});

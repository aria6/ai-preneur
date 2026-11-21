/// <reference types="vite/client" />

/** Client-exposed environment variables. Only VITE_-prefixed keys reach the browser. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOGIN_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

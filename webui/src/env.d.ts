/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the verifier worker.
   * Defaults to http://127.0.0.1:8787 when unset (local development).
   */
  readonly PUBLIC_VERIFIER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

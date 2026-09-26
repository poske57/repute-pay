/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the verifier worker. Defaults to http://127.0.0.1:8787 when
   * unset (local development).
   */
  readonly PUBLIC_VERIFIER_URL?: string;

  /** Address of the deployed JobsManager contract (0x...). */
  readonly PUBLIC_JOBS_MANAGER_ADDRESS?: string;

  /** Chain ID the app should operate on (e.g. 480 = World Chain, 11155111 = Sepolia). */
  readonly PUBLIC_CHAIN_ID?: string;

  /** World ID app_id (app_...). */
  readonly PUBLIC_WORLD_APP_ID?: string;

  /** World ID rp_id (rp_...). Must match the verifier's WORLD_RP_ID. */
  readonly PUBLIC_WORLD_RP_ID?: string;

  /** World ID action. Must match the verifier's WORLD_ACTION. Defaults to "register". */
  readonly PUBLIC_WORLD_ACTION?: string;

  /** World ID environment: "production" | "staging" | "sandbox". Defaults to "production". */
  readonly PUBLIC_WORLD_ENVIRONMENT?: string;

  /** ERC-20 address used as the registration stake asset (whitelisted on-chain). */
  readonly PUBLIC_STAKE_ASSET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

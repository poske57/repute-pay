/**
 * Central, build-time configuration for the ReputePay web UI.
 *
 * Everything here is public (bundled into the client), so no secrets may live
 * in this file. Values are read from `PUBLIC_*` environment variables at build
 * time and fall back to sensible local-development defaults.
 */

/** Default verifier worker base URL (local `verifier` wrangler dev). */
export const VERIFIER_URL = (
  import.meta.env.PUBLIC_VERIFIER_URL ?? "http://127.0.0.1:8787"
).replace(/\/+$/, "");

/** World ID app_id from the Developer Portal. */
export const WORLD_APP_ID = (import.meta.env.PUBLIC_WORLD_APP_ID ?? "") as
  | `app_${string}`
  | "";

/** World ID rp_id; must match the verifier's WORLD_RP_ID. */
export const WORLD_RP_ID = import.meta.env.PUBLIC_WORLD_RP_ID ?? "";

/** World ID action; must match the verifier's WORLD_ACTION. */
export const WORLD_ACTION = import.meta.env.PUBLIC_WORLD_ACTION ?? "register";

/** World ID environment. */
export const WORLD_ENVIRONMENT = (import.meta.env.PUBLIC_WORLD_ENVIRONMENT ??
  "production") as "production" | "staging" | "sandbox";

/** Address of the deployed JobsManager contract. */
export const JOBS_MANAGER_ADDRESS = (import.meta.env
  .PUBLIC_JOBS_MANAGER_ADDRESS ?? "") as `0x${string}` | "";

/** Chain the app operates on. Defaults to World Chain (480). */
export const CHAIN_ID = Number(import.meta.env.PUBLIC_CHAIN_ID ?? "480");

/**
 * Human-readable, explorer-aware metadata for the supported chains. Unknown
 * chains fall back to a generic entry so the UI still renders.
 */
export interface ChainMetadata {
  id: number;
  name: string;
  /** Native currency symbol (used for gas displays). */
  nativeCurrency: string;
  /** Block explorer base URL, without a trailing slash. */
  explorerUrl?: string;
}

export const CHAINS: Record<number, ChainMetadata> = {
  1: {
    id: 1,
    name: "Ethereum",
    nativeCurrency: "ETH",
    explorerUrl: "https://etherscan.io",
  },
  480: {
    id: 480,
    name: "World Chain",
    nativeCurrency: "ETH",
    explorerUrl: "https://worldscan.org",
  },
  11155111: {
    id: 11155111,
    name: "Sepolia",
    nativeCurrency: "ETH",
    explorerUrl: "https://sepolia.etherscan.io",
  },
  11155420: {
    id: 11155420,
    name: "OP Sepolia",
    nativeCurrency: "ETH",
    explorerUrl: "https://sepolia-optimism.etherscan.io",
  },
  84532: {
    id: 84532,
    name: "Base Sepolia",
    nativeCurrency: "ETH",
    explorerUrl: "https://sepolia.basescan.org",
  },
  4801: {
    id: 4801,
    name: "World Chain Sepolia",
    nativeCurrency: "ETH",
    explorerUrl: "https://sepolia.worldscan.org",
  },
};

export function chainMetadata(chainId: number): ChainMetadata {
  return (
    CHAINS[chainId] ?? {
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: "ETH",
    }
  );
}

/** True when the contract address has been configured. */
export function hasContractAddress(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(JOBS_MANAGER_ADDRESS);
}

/** Builds a block-explorer link for a transaction hash, if one is known. */
export function txExplorerUrl(chainId: number, hash: string): string | undefined {
  const base = chainMetadata(chainId).explorerUrl;
  return base ? `${base}/tx/${hash}` : undefined;
}

/** Builds a block-explorer link for an address, if one is known. */
export function addressExplorerUrl(
  chainId: number,
  address: string,
): string | undefined {
  const base = chainMetadata(chainId).explorerUrl;
  return base ? `${base}/address/${address}` : undefined;
}

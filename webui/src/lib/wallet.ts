/**
 * Wallet-agnostic helpers around EIP-1193 (`window.ethereum`) and EIP-6963.
 *
 * The UI talks to whatever provider the browser exposes. All access goes
 * through these helpers so that components never touch `window.ethereum`
 * directly and error handling stays consistent.
 */

export interface Eip1193Provider {
  request(args: {
    method: string;
    params?: unknown[] | object;
  }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/** Error thrown when no injected wallet is available. */
export class NoWalletError extends Error {
  constructor() {
    super(
      "No wallet found. Install a browser wallet such as MetaMask.",
    );
    this.name = "NoWalletError";
  }
}

/** Returns the injected EIP-1193 provider, or throws `NoWalletError`. */
export function getProvider(): Eip1193Provider {
  const provider = window.ethereum;
  if (!provider) {
    throw new NoWalletError();
  }
  return provider;
}

/** True when an injected wallet is present. */
export function hasWallet(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

/** Requests access to the wallet's accounts and returns them. */
export async function requestAccounts(): Promise<`0x${string}`[]> {
  const provider = getProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  return normalizeAccounts(accounts);
}

/** Returns already-authorized accounts without prompting ([] when locked). */
export async function getAccounts(): Promise<`0x${string}`[]> {
  const provider = getProvider();
  const accounts = await provider.request({ method: "eth_accounts" });
  return normalizeAccounts(accounts);
}

function normalizeAccounts(value: unknown): `0x${string}`[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is `0x${string}` =>
      typeof entry === "string" && /^0x[0-9a-fA-F]{40}$/.test(entry),
  );
}

/** Returns the chain ID the wallet is currently connected to. */
export async function getChainId(): Promise<number> {
  const provider = getProvider();
  const value = await provider.request({ method: "eth_chainId" });
  if (typeof value !== "string") {
    throw new Error("Wallet returned an invalid chainId");
  }
  return Number.parseInt(value, 16);
}

/**
 * Requests a chain switch. Returns `true` on success and `false` when the
 * wallet does not know the chain (EIP-1193 error 4902).
 */
export async function switchChain(chainId: number): Promise<boolean> {
  const provider = getProvider();
  const chainIdHex = `0x${chainId.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return true;
  } catch (cause) {
    if ((cause as { code?: number }).code === 4902) {
      return false;
    }
    throw cause;
  }
}

/**
 * Requests a chain switch and, if the chain is unknown, adds it with
 * `wallet_addEthereumChain`. `rpcUrls` is required for the add step.
 */
export async function switchOrAddChain(params: {
  chainId: number;
  chainName: string;
  nativeCurrency: string;
  rpcUrls: string[];
  blockExplorerUrls?: string[];
}): Promise<void> {
  const switched = await switchChain(params.chainId);
  if (switched) {
    return;
  }

  const provider = getProvider();
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: `0x${params.chainId.toString(16)}`,
        chainName: params.chainName,
        nativeCurrency: {
          name: params.nativeCurrency,
          symbol: params.nativeCurrency,
          decimals: 18,
        },
        rpcUrls: params.rpcUrls,
        blockExplorerUrls: params.blockExplorerUrls,
      },
    ],
  });
}

/** True when the error is the user rejecting a wallet request (EIP-1193 4001). */
export function isUserRejected(cause: unknown): boolean {
  return (cause as { code?: number }).code === 4001;
}

/**
 * Extracts a short revert reason from a viem/wallet error for display.
 * Falls back to `cause.message` when no revert reason is present.
 */
export function describeWalletError(cause: unknown): string {
  if (isUserRejected(cause)) {
    return "The request was rejected in the wallet.";
  }

  const error = cause as {
    shortMessage?: string;
    metaMessages?: string[];
    message?: string;
    details?: string;
  };

  return (
    error.shortMessage ??
    error.details ??
    error.message ??
    "An unknown error occurred."
  );
}

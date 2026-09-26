/**
 * Global wallet state shared across Astro islands.
 *
 * Astro mounts each `client:*` island as an independent React tree, so React
 * context cannot be shared between the header button and the page body. A
 * nanostore is the idiomatic solution: a single module-level store that every
 * island subscribes to.
 */
import { atom, computed } from "nanostores";
import { CHAIN_ID, chainMetadata } from "./config";
import {
  NoWalletError,
  getAccounts,
  getChainId,
  hasWallet,
  requestAccounts,
  switchChain,
} from "./wallet";

export interface WalletSnapshot {
  /** Whether an injected wallet exists in the browser. */
  available: boolean;
  /** The connected account, or null when disconnected. */
  address: `0x${string}` | null;
  /** The chain the wallet is currently on, or null when unknown. */
  chainId: number | null;
  /** True while a connection request is in flight. */
  connecting: boolean;
  error: string | null;
}

const initial: WalletSnapshot = {
  available: false,
  address: null,
  chainId: null,
  connecting: false,
  error: null,
};

export const walletStore = atom<WalletSnapshot>(initial);

/** True when a wallet is connected and on the expected chain. */
export const isReady = computed(walletStore, (state) => {
  return state.address !== null && state.chainId === CHAIN_ID;
});

/** True when a wallet is connected but on the wrong chain. */
export const isWrongChain = computed(walletStore, (state) => {
  return state.address !== null && state.chainId !== null && state.chainId !== CHAIN_ID;
});

function patch(values: Partial<WalletSnapshot>): void {
  walletStore.set({ ...walletStore.get(), ...values });
}

/** Detects the wallet and restores any pre-authorized account. */
export async function refreshWallet(): Promise<void> {
  if (!hasWallet()) {
    patch({ available: false, address: null, chainId: null });
    return;
  }
  patch({ available: true });
  try {
    const accounts = await getAccounts();
    patch({ address: accounts[0] ?? null, chainId: await getChainId() });
  } catch {
    // Wallet present but locked/unavailable; leave existing state.
  }
}

/** Requests wallet access and connects. */
export async function connectWallet(): Promise<void> {
  patch({ error: null, connecting: true });
  try {
    const accounts = await requestAccounts();
    patch({ address: accounts[0] ?? null, chainId: await getChainId() });
  } catch (cause) {
    if (cause instanceof NoWalletError) {
      patch({ error: cause.message });
    } else if ((cause as { code?: number }).code === 4001) {
      patch({ error: "接続が拒否されました。" });
    } else {
      patch({
        error: (cause as Error).message ?? "ウォレットへの接続に失敗しました。",
      });
    }
  } finally {
    patch({ connecting: false });
  }
}

/** Drops local connection state (EIP-1193 has no standard disconnect). */
export function disconnectWallet(): void {
  patch({ address: null, error: null });
}

/** Requests a switch to the expected chain. Returns success. */
export async function switchToExpectedChain(): Promise<boolean> {
  patch({ error: null });
  try {
    const switched = await switchChain(CHAIN_ID);
    if (!switched) {
      patch({
        error: `ウォレットに ${chainMetadata(CHAIN_ID).name} (chainId ${CHAIN_ID}) が登録されていません。`,
      });
      return false;
    }
    patch({ chainId: await getChainId() });
    return true;
  } catch (cause) {
    if ((cause as { code?: number }).code === 4001) {
      patch({ error: "チェーン切り替えが拒否されました。" });
    } else {
      patch({
        error: (cause as Error).message ?? "チェーン切り替えに失敗しました。",
      });
    }
    return false;
  }
}

let listenersAttached = false;

/** Attaches wallet event listeners exactly once (idempotent). */
export function initWalletListeners(): void {
  if (typeof window === "undefined") {
    return;
  }

  // Guard across separately bundled islands via a window flag, so events are
  // not handled (and state not reset) more than once.
  const globalFlag = "__reputeWalletListenersAttached";
  const globalWindow = window as unknown as Record<string, boolean | undefined>;
  if (listenersAttached || globalWindow[globalFlag]) {
    return;
  }

  const provider = window.ethereum;
  if (!provider?.on) {
    return;
  }
  listenersAttached = true;
  globalWindow[globalFlag] = true;

  provider.on("accountsChanged", (...args: unknown[]) => {
    const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
    patch({ address: (accounts[0] as `0x${string}`) ?? null });
  });
  provider.on("chainChanged", (...args: unknown[]) => {
    const value = args[0];
    if (typeof value === "string") {
      patch({ chainId: Number.parseInt(value, 16) });
    }
  });

  void refreshWallet();
}

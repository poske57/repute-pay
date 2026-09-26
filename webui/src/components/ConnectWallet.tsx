/**
 * Connect-wallet button. Shows the connected account and chain, and offers a
 * chain switch when the wallet is on the wrong network.
 */
import { useStore } from "@nanostores/react";
import {
  connectWallet,
  disconnectWallet,
  isWrongChain,
  switchToExpectedChain,
  walletStore,
} from "../lib/walletStore";
import { CHAIN_ID, chainMetadata } from "../lib/config";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function ConnectWallet() {
  const wallet = useStore(walletStore);
  const wrongChain = useStore(isWrongChain);

  if (!wallet.available) {
    return (
      <span
        className="wallet-note"
        title="Could not detect a browser wallet such as MetaMask"
      >
        No wallet detected
      </span>
    );
  }

  if (!wallet.address) {
    return (
      <div className="wallet">
        <button
          type="button"
          onClick={() => void connectWallet()}
          disabled={wallet.connecting}
        >
          {wallet.connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {wallet.error ? <span className="wallet-error">{wallet.error}</span> : null}
      </div>
    );
  }

  return (
    <div className="wallet">
      <span className="wallet-chip" title={wallet.address}>
        <span className="dot" data-ok={!wrongChain} />
        {shortAddress(wallet.address)}
      </span>
      {wrongChain ? (
        <button
          type="button"
          className="switch"
          onClick={() => void switchToExpectedChain()}
          title={`Switch to ${chainMetadata(CHAIN_ID).name} (${CHAIN_ID})`}
        >
          {wallet.chainId !== null ? `Chain ${wallet.chainId}` : "Wrong chain"} → Switch
        </button>
      ) : null}
      <button type="button" className="secondary" onClick={disconnectWallet}>
        Disconnect
      </button>
      {wallet.error ? <span className="wallet-error">{wallet.error}</span> : null}
    </div>
  );
}

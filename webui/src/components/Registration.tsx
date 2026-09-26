/**
 * Registration page.
 *
 * Shows exactly one of two panels depending on the connected account's
 * on-chain status (`clientStaked`):
 *
 *  - **Register** — verify with World ID, then send `registerAndStake`.
 *  - **Unregister** — send `unregisterAndUnstake` to get the stake back.
 */
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import {
  IDKitRequestWidget,
  proofOfHuman,
  type IDKitErrorCodes,
  type IDKitResult,
} from "@worldcoin/idkit";
import {
  CHAIN_ID,
  WORLD_ACTION,
  WORLD_APP_ID,
  WORLD_ENVIRONMENT,
  WORLD_RP_ID,
  chainMetadata,
  hasContractAddress,
} from "../lib/config";
import {
  MissingContractError,
  readClientStake,
  registerAndStake,
  unregisterAndUnstake,
  type Stake,
} from "../lib/jobsManager";
import {
  buildRegisterData,
  fetchRpContext,
  verifyIdkitResult,
} from "../lib/worldid";
import { describeWalletError } from "../lib/wallet";
import { initWalletListeners, isWrongChain, walletStore } from "../lib/walletStore";
import { formatTokenAmount, formatAddress } from "../lib/format";

type Phase = "idle" | "submitting" | "success" | "error";

export default function Registration() {
  const wallet = useStore(walletStore);
  const wrongChain = useStore(isWrongChain);

  const [staked, setStaked] = useState<boolean | null>(null);
  const [stake, setStake] = useState<Stake | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [rpContext, setRpContext] = useState<Awaited<
    ReturnType<typeof fetchRpContext>
  > | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [registerData, setRegisterData] = useState<`0x${string}` | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    initWalletListeners();
  }, []);

  const loadStatus = useCallback(async (address: `0x${string}`) => {
    setStatusError(null);
    setStaked(null);
    setStake(null);
    try {
      const stake = await readClientStake(address);
      setStake(stake);
      setStaked(stake.stakedAmount !== 0n);
    } catch (cause) {
      if (cause instanceof MissingContractError) {
        setStatusError(cause.message);
        setStaked(false);
      } else {
        setStatusError(describeWalletError(cause));
        setStaked(false);
      }
    }
  }, []);

  useEffect(() => {
    if (wallet.address) {
      void loadStatus(wallet.address);
    } else {
      setStaked(null);
      setStake(null);
    }
  }, [wallet.address, loadStatus]);

  const contractReady = hasContractAddress();

  async function openIdkitWidget() {
    setMessage(null);
    setRegisterData(null);
    try {
      if (!WORLD_APP_ID) {
        throw new Error("PUBLIC_WORLD_APP_ID is not set.");
      }
      if (!WORLD_RP_ID) {
        throw new Error("PUBLIC_WORLD_RP_ID is not set.");
      }
      const context = await fetchRpContext();
      setRpContext(context);
      setWidgetOpen(true);
    } catch (cause) {
      setPhase("error");
      setMessage(describeWalletError(cause));
    }
  }

  /**
   * IDKit host verification: verify the proof with the worker and stash the
   * receipt. Throwing here aborts the widget, so the transaction is not sent
   * for an unverified proof.
   */
  async function handleVerify(result: IDKitResult) {
    if (!wallet.address) {
      throw new Error("Wallet is not connected.");
    }

    setPhase("submitting");
    setMessage("Verifying World ID proof with the verifier…");

    try {
      const receipt = await verifyIdkitResult(result, wallet.address);
      const data = buildRegisterData(receipt, wallet.address);
      if (!data) {
        throw new Error(
          "The verifier did not return the nullifier / serviceSignature required for registerAndStake. Check the verifier's response format.",
        );
      }
      setRegisterData(data);
    } catch (cause) {
      setPhase("error");
      setMessage(describeWalletError(cause));
      throw cause;
    }
  }

  /** Runs after IDKit succeeds: sends the `registerAndStake` transaction. */
  async function handleSuccess() {
    if (!wallet.address || !registerData) {
      return;
    }

    setMessage("Sending the registerAndStake transaction…");
    try {
      const hash = await registerAndStake(stakeAsset(), registerData);
      setTxHash(hash);
      setPhase("success");
      setMessage("Registration complete.");
      await loadStatus(wallet.address);
    } catch (cause) {
      setPhase("error");
      setMessage(describeWalletError(cause));
    }
  }

  async function handleUnregister() {
    if (!wallet.address) {
      return;
    }
    setPhase("submitting");
    setTxHash(null);
    setMessage("Sending the unregisterAndUnstake transaction…");
    try {
      const hash = await unregisterAndUnstake();
      setTxHash(hash);
      setPhase("success");
      setMessage("Unregistration complete. Your stake has been returned.");
      await loadStatus(wallet.address);
    } catch (cause) {
      setPhase("error");
      setMessage(describeWalletError(cause));
    }
  }

  function handleIdkitError(code: IDKitErrorCodes) {
    setPhase("error");
    setMessage(`World ID error: ${code}`);
  }

  // --- Render ---------------------------------------------------------------

  if (!contractReady) {
    return (
      <section className="card">
        <h2>Registration</h2>
        <p className="err">
          Contract address is not set. Set <code>PUBLIC_JOBS_MANAGER_ADDRESS</code>{" "}
          and rebuild.
        </p>
      </section>
    );
  }

  if (!wallet.available) {
    return (
      <section className="card">
        <h2>Registration</h2>
        <p className="muted">
          Could not detect a wallet. Install a browser wallet such as MetaMask,
          then click "Connect wallet" in the top right.
        </p>
      </section>
    );
  }

  if (!wallet.address) {
    return (
      <section className="card">
        <h2>Registration</h2>
        <p className="muted">
          To check your registration status, connect a wallet using "Connect
          wallet" in the top right.
        </p>
      </section>
    );
  }

  if (wrongChain) {
    return (
      <section className="card">
        <h2>Registration</h2>
        <p className="err">
          The wallet is not connected to {chainMetadata(CHAIN_ID).name} (chainId {CHAIN_ID}).
          Press "Switch" in the top right.
        </p>
      </section>
    );
  }

  if (staked === null) {
    return (
      <section className="card">
        <h2>Registration</h2>
        <p className="muted">Loading account status…</p>
        {statusError ? <p className="err">{statusError}</p> : null}
      </section>
    );
  }

  return (
    <div>
      <section className="card">
        <h2>
          Account status
          <span className="badge" data-on={staked}>
            {staked ? "Registered" : "Not registered"}
          </span>
        </h2>
        <dl className="kv">
          <dt>Address</dt>
          <dd>
            <code>{formatAddress(wallet.address)}</code>
          </dd>
          <dt>Network</dt>
          <dd>
            {chainMetadata(CHAIN_ID).name} ({CHAIN_ID})
          </dd>
          {staked && stake ? (
            <>
              <dt>Staked asset</dt>
              <dd>
                <code>{formatAddress(stake.stakedAsset)}</code>
              </dd>
              <dt>Staked amount</dt>
              <dd>{formatTokenAmount(stake.stakedAmount)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {staked ? (
        <UnregisterPanel
          phase={phase}
          message={message}
          txHash={txHash}
          onUnregister={() => void handleUnregister()}
        />
      ) : (
        <RegisterPanel
          phase={phase}
          message={message}
          txHash={txHash}
          rpContext={rpContext}
          widgetOpen={widgetOpen}
          onOpenChange={setWidgetOpen}
          onStart={() => void openIdkitWidget()}
          onVerify={handleVerify}
          onSuccess={handleSuccess}
          onError={handleIdkitError}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panels                                                                     */
/* -------------------------------------------------------------------------- */

interface RegisterPanelProps {
  phase: Phase;
  message: string | null;
  txHash: string | null;
  rpContext: Awaited<ReturnType<typeof fetchRpContext>> | null;
  widgetOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
  onVerify: (result: IDKitResult) => void | Promise<void>;
  onSuccess: (result: IDKitResult) => void | Promise<void>;
  onError: (code: IDKitErrorCodes) => void;
}

function RegisterPanel({
  phase,
  message,
  txHash,
  rpContext,
  widgetOpen,
  onOpenChange,
  onStart,
  onVerify,
  onSuccess,
  onError,
}: RegisterPanelProps) {
  const busy = phase === "submitting";

  return (
    <section className="card">
      <h2>Register</h2>
      <p className="muted">
        Prove you are human with World ID and register as a client by staking.
      </p>

      <ol className="steps">
        <li>
          <strong>World ID verification</strong> — start verification from the button below.
        </li>
        <li>
          <strong>Send transaction</strong> — after verification, approve{" "}
          <code>registerAndStake</code> in your wallet.
        </li>
      </ol>

      <div className="row">
        <button type="button" onClick={onStart} disabled={busy}>
          {busy ? "Processing…" : "Verify with World ID and register"}
        </button>
      </div>

      {rpContext ? (
        <IDKitRequestWidget
          open={widgetOpen}
          onOpenChange={onOpenChange}
          app_id={WORLD_APP_ID as `app_${string}`}
          action={WORLD_ACTION}
          rp_context={rpContext}
          allow_legacy_proofs={false}
          environment={WORLD_ENVIRONMENT}
          preset={proofOfHuman()}
          handleVerify={onVerify}
          onSuccess={onSuccess}
          onError={onError}
          autoClose
        />
      ) : null}

      <StatusBlock phase={phase} message={message} txHash={txHash} />
    </section>
  );
}

interface UnregisterPanelProps {
  phase: Phase;
  message: string | null;
  txHash: string | null;
  onUnregister: () => void;
}

function UnregisterPanel({
  phase,
  message,
  txHash,
  onUnregister,
}: UnregisterPanelProps) {
  const busy = phase === "submitting";

  return (
    <section className="card">
      <h2>Unregister</h2>
      <p className="muted">
        Unregister and withdraw your staked assets. This fails if there are any
        incomplete jobs.
      </p>
      <div className="row">
        <button type="button" className="danger" onClick={onUnregister} disabled={busy}>
          {busy ? "Processing…" : "Unregister & Unstake"}
        </button>
      </div>
      <StatusBlock phase={phase} message={message} txHash={txHash} />
    </section>
  );
}

function StatusBlock({
  phase,
  message,
  txHash,
}: {
  phase: Phase;
  message: string | null;
  txHash: string | null;
}) {
  if (!message) {
    return null;
  }
  const className =
    phase === "error" ? "status err" : phase === "success" ? "status ok" : "status";
  const explorer =
    txHash && chainMetadata(CHAIN_ID).explorerUrl
      ? `${chainMetadata(CHAIN_ID).explorerUrl}/tx/${txHash}`
      : undefined;

  return (
    <div className={className}>
      <p>{message}</p>
      {txHash ? (
        explorer ? (
          <a href={explorer} target="_blank" rel="noopener noreferrer">
            {txHash}
          </a>
        ) : (
          <code>{txHash}</code>
        )
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Asset used for `registerAndStake`. The contract's supported assets are
 * admin-configured; the UI defaults to the native-currency placeholder address
 * unless overridden. Set `PUBLIC_STAKE_ASSET` to the whitelisted ERC-20.
 */
function stakeAsset(): `0x${string}` {
  const configured = import.meta.env.PUBLIC_STAKE_ASSET;
  if (configured && /^0x[0-9a-fA-F]{40}$/.test(configured)) {
    return configured as `0x${string}`;
  }
  // Zero address will revert with InvalidAsset until configured; surfaced as a
  // wallet error so the misconfiguration is obvious.
  return "0x0000000000000000000000000000000000000000";
}

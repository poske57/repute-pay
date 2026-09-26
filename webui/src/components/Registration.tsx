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
        throw new Error("PUBLIC_WORLD_APP_ID が未設定です。");
      }
      if (!WORLD_RP_ID) {
        throw new Error("PUBLIC_WORLD_RP_ID が未設定です。");
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
      throw new Error("ウォレットが接続されていません。");
    }

    setPhase("submitting");
    setMessage("World ID の証明を verifier で検証しています…");

    try {
      const receipt = await verifyIdkitResult(result, wallet.address);
      const data = buildRegisterData(receipt, wallet.address);
      if (!data) {
        throw new Error(
          "verifier が registerAndStake に必要な nullifier / serviceSignature を返しませんでした。verifier のレスポンス形式を確認してください。",
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

    setMessage("registerAndStake トランザクションを送信しています…");
    try {
      const hash = await registerAndStake(stakeAsset(), registerData);
      setTxHash(hash);
      setPhase("success");
      setMessage("登録が完了しました。");
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
    setMessage("unregisterAndUnstake トランザクションを送信しています…");
    try {
      const hash = await unregisterAndUnstake();
      setTxHash(hash);
      setPhase("success");
      setMessage("登録解除が完了しました。ステークが返還されました。");
      await loadStatus(wallet.address);
    } catch (cause) {
      setPhase("error");
      setMessage(describeWalletError(cause));
    }
  }

  function handleIdkitError(code: IDKitErrorCodes) {
    setPhase("error");
    setMessage(`World ID エラー: ${code}`);
  }

  // --- Render ---------------------------------------------------------------

  if (!contractReady) {
    return (
      <section className="card">
        <h2>Registration</h2>
        <p className="err">
          コントラクトアドレスが未設定です。<code>PUBLIC_JOBS_MANAGER_ADDRESS</code>{" "}
          を設定してビルドしてください。
        </p>
      </section>
    );
  }

  if (!wallet.available) {
    return (
      <section className="card">
        <h2>Registration</h2>
        <p className="muted">
          ウォレットを検出できませんでした。MetaMask 等のブラウザウォレットを
          インストールしてから、右上の「Connect wallet」を押してください。
        </p>
      </section>
    );
  }

  if (!wallet.address) {
    return (
      <section className="card">
        <h2>Registration</h2>
        <p className="muted">
          登録状況を確認するには、右上の「Connect wallet」でウォレットを接続してください。
        </p>
      </section>
    );
  }

  if (wrongChain) {
    return (
      <section className="card">
        <h2>Registration</h2>
        <p className="err">
          ウォレットが {chainMetadata(CHAIN_ID).name} (chainId {CHAIN_ID}) に接続されていません。
          右上の「切り替え」を押してください。
        </p>
      </section>
    );
  }

  if (staked === null) {
    return (
      <section className="card">
        <h2>Registration</h2>
        <p className="muted">アカウント状況を読み込んでいます…</p>
        {statusError ? <p className="err">{statusError}</p> : null}
      </section>
    );
  }

  return (
    <div>
      <section className="card">
        <h2>
          アカウント状況
          <span className="badge" data-on={staked}>
            {staked ? "登録済み" : "未登録"}
          </span>
        </h2>
        <dl className="kv">
          <dt>アドレス</dt>
          <dd>
            <code>{formatAddress(wallet.address)}</code>
          </dd>
          <dt>ネットワーク</dt>
          <dd>
            {chainMetadata(CHAIN_ID).name} ({CHAIN_ID})
          </dd>
          {staked && stake ? (
            <>
              <dt>ステーク資産</dt>
              <dd>
                <code>{formatAddress(stake.stakedAsset)}</code>
              </dd>
              <dt>ステーク額</dt>
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
        World ID で人間であることを証明し、ステークを行ってクライアントとして登録します。
      </p>

      <ol className="steps">
        <li>
          <strong>World ID 認証</strong> — 下のボタンから認証を開始します。
        </li>
        <li>
          <strong>トランザクション送信</strong> — 認証後、ウォレットで{" "}
          <code>registerAndStake</code> を承認します。
        </li>
      </ol>

      <div className="row">
        <button type="button" onClick={onStart} disabled={busy}>
          {busy ? "処理中…" : "World ID で認証して登録"}
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
        登録を解除し、ステークした資産を引き出します。未完了のジョブがある場合は失敗します。
      </p>
      <div className="row">
        <button type="button" className="danger" onClick={onUnregister} disabled={busy}>
          {busy ? "処理中…" : "Unregister & Unstake"}
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

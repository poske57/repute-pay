/**
 * "Add job" form.
 *
 * Calls `createJob(jobHash, asset, amount, duration, resolver)`. The contract
 * requires the client to hold and have approved enough of `asset` to cover
 * this job plus every other un-escrowed job; this form performs the approval
 * first when needed.
 */
import { useState } from "react";
import { useStore } from "@nanostores/react";
import { pad, toHex, type Address } from "viem";
import { createJob } from "../lib/jobsManager";
import { describeWalletError } from "../lib/wallet";
import { isWrongChain, walletStore } from "../lib/walletStore";
import { CHAIN_ID, chainMetadata } from "../lib/config";
import {
  getPublicClient,
  getWalletClient,
  readIsSupportedAsset,
  requireContractAddress,
} from "../lib/jobsManager";

interface Props {
  onCreated: () => void;
}

type Phase = "idle" | "submitting" | "success" | "error";

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function parseAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("金額は正の数値で入力してください。");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`小数点以下は最大 ${decimals} 桁です。`);
  }
  const padded = fraction.padEnd(decimals, "0");
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  if (amount === 0n) {
    throw new Error("金額は 0 より大きい必要があります。");
  }
  return amount;
}

export default function AddJobForm({ onCreated }: Props) {
  const wallet = useStore(walletStore);
  const wrongChain = useStore(isWrongChain);

  const [jobHashText, setJobHashText] = useState("");
  const [asset, setAsset] = useState("");
  const [amount, setAmount] = useState("");
  const [durationHours, setDurationHours] = useState("72");
  const [resolver, setResolver] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (!wallet.address) {
      setPhase("error");
      setMessage("ウォレットを接続してください。");
      return;
    }

    setPhase("submitting");
    setMessage(null);

    try {
      if (!isAddress(asset)) {
        throw new Error("asset は ERC-20 アドレス (0x...) を入力してください。");
      }
      if (!isAddress(resolver)) {
        throw new Error("resolver はアドレス (0x...) を入力してください。");
      }
      if (resolver.toLowerCase() === wallet.address.toLowerCase()) {
        throw new Error("resolver に自分自身は指定できません。");
      }

      const supported = await readIsSupportedAsset(asset);
      if (!supported) {
        throw new Error(
          "この asset はコントラクトで許可されていません（stakeRequirement が 0）。",
        );
      }

      const publicClient = getPublicClient();
      const decimals = (await publicClient.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "decimals",
      })) as number;

      const parsedAmount = parseAmount(amount, Number(decimals));
      const parsedDuration = Number(durationHours);
      if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
        throw new Error("期間（時間）は正の数値で入力してください。");
      }
      const durationSeconds = Math.floor(parsedDuration * 3600);

      // The contract checks cumulative approval, so approve enough to cover
      // this job before creating it.
      const spender = requireContractAddress();
      const currentAllowance = (await publicClient.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [wallet.address, spender],
      })) as bigint;

      if (currentAllowance < parsedAmount) {
        setMessage("トークンの approve をウォレットで承認してください…");
        const walletClient = await getWalletClient();
        const approveHash = await walletClient.writeContract({
          address: asset,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [spender, parsedAmount],
          account: walletClient.account!,
          chain: null,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      setMessage("createJob トランザクションを送信しています…");
      const jobHash = jobHashText.trim()
        ? (toHex(jobHashText.trim()) as `0x${string}`)
        : (pad("0x00", { size: 32 }) as `0x${string}`);

      await createJob({
        jobHash,
        asset,
        amount: parsedAmount,
        duration: durationSeconds,
        resolver,
      });

      setPhase("success");
      setMessage("ジョブを作成しました。");
      setJobHashText("");
      setAmount("");
      onCreated();
    } catch (cause) {
      setPhase("error");
      setMessage(describeWalletError(cause));
    }
  }

  const disabled = phase === "submitting" || !wallet.address || wrongChain;

  return (
    <section className="card">
      <h2>Add job</h2>
      {wrongChain ? (
        <p className="err">
          {chainMetadata(CHAIN_ID).name} に接続してください。
        </p>
      ) : null}

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="job-hash">ジョブ内容 (jobHash)</label>
          <input
            id="job-hash"
            type="text"
            placeholder="例: ipfs://… やメモ（UTF-8 で bytes32 に変換）"
            value={jobHashText}
            onChange={(event) => setJobHashText(event.target.value)}
            autoComplete="off"
          />
          <small>
            off-chain のジョブ識別子。空欄の場合はゼロ埋めされた bytes32 になります。
          </small>
        </div>

        <div className="field">
          <label htmlFor="asset">支払い資産 (asset)</label>
          <input
            id="asset"
            type="text"
            placeholder="0x..."
            value={asset}
            onChange={(event) => setAsset(event.target.value)}
            autoComplete="off"
          />
          <small>コントラクトで許可された ERC-20 アドレス。</small>
        </div>

        <div className="field">
          <label htmlFor="amount">金額 (amount)</label>
          <input
            id="amount"
            type="text"
            placeholder="例: 100.5"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            autoComplete="off"
          />
          <small>トークンの表示単位で入力します（decimals に応じて変換）。</small>
        </div>

        <div className="field">
          <label htmlFor="duration">期間（時間）</label>
          <input
            id="duration"
            type="number"
            min="1"
            value={durationHours}
            onChange={(event) => setDurationHours(event.target.value)}
          />
          <small>acceptJob までの猶予（creationTime + duration）。</small>
        </div>

        <div className="field">
          <label htmlFor="resolver">resolver アドレス</label>
          <input
            id="resolver"
            type="text"
            placeholder="0x..."
            value={resolver}
            onChange={(event) => setResolver(event.target.value)}
            autoComplete="off"
          />
          <small>ジョブの完了を判定する第三者のアドレス。</small>
        </div>

        <div className="row">
          <button type="submit" disabled={disabled}>
            {phase === "submitting" ? "処理中…" : "Create job"}
          </button>
        </div>
      </form>

      {message ? (
        <div className={phase === "error" ? "status err" : phase === "success" ? "status ok" : "status"}>
          <p>{message}</p>
        </div>
      ) : null}
    </section>
  );
}

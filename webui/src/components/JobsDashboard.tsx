/**
 * Jobs dashboard page: lists the connected client's jobs and lets them create
 * new ones.
 */
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import AddJobForm from "./AddJobForm";
import JobList from "./JobList";
import { readClientJobs, type Job } from "../lib/jobsManager";
import { describeWalletError } from "../lib/wallet";
import { initWalletListeners, isWrongChain, walletStore } from "../lib/walletStore";
import { CHAIN_ID, chainMetadata, hasContractAddress } from "../lib/config";

export default function JobsDashboard() {
  const wallet = useStore(walletStore);
  const wrongChain = useStore(isWrongChain);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initWalletListeners();
  }, []);

  const load = useCallback(async (address: `0x${string}`) => {
    setLoading(true);
    setError(null);
    try {
      const result = await readClientJobs(address);
      setJobs(result);
    } catch (cause) {
      setError(describeWalletError(cause));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (wallet.address && !wrongChain) {
      void load(wallet.address);
    } else {
      setJobs([]);
    }
  }, [wallet.address, wrongChain, load]);

  if (!hasContractAddress()) {
    return (
      <section className="card">
        <h2>Jobs dashboard</h2>
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
        <h2>Jobs dashboard</h2>
        <p className="muted">
          ウォレットを検出できませんでした。ブラウザウォレットをインストールしてください。
        </p>
      </section>
    );
  }

  if (!wallet.address) {
    return (
      <section className="card">
        <h2>Jobs dashboard</h2>
        <p className="muted">
          ジョブを表示するには、右上の「Connect wallet」でウォレットを接続してください。
        </p>
      </section>
    );
  }

  if (wrongChain) {
    return (
      <section className="card">
        <h2>Jobs dashboard</h2>
        <p className="err">
          {chainMetadata(CHAIN_ID).name} (chainId {CHAIN_ID}) に接続してください。
        </p>
      </section>
    );
  }

  return (
    <div>
      <AddJobForm onCreated={() => wallet.address && void load(wallet.address)} />
      {error ? (
        <section className="card">
          <p className="err">{error}</p>
        </section>
      ) : null}
      <JobList
        jobs={jobs}
        loading={loading}
        onRefresh={() => wallet.address && void load(wallet.address)}
      />
    </div>
  );
}

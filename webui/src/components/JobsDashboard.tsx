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
          Contract address is not set. Set <code>PUBLIC_JOBS_MANAGER_ADDRESS</code>{" "}
          and rebuild.
        </p>
      </section>
    );
  }

  if (!wallet.available) {
    return (
      <section className="card">
        <h2>Jobs dashboard</h2>
        <p className="muted">
          Could not detect a wallet. Install a browser wallet.
        </p>
      </section>
    );
  }

  if (!wallet.address) {
    return (
      <section className="card">
        <h2>Jobs dashboard</h2>
        <p className="muted">
          To view jobs, connect a wallet using "Connect wallet" in the top right.
        </p>
      </section>
    );
  }

  if (wrongChain) {
    return (
      <section className="card">
        <h2>Jobs dashboard</h2>
        <p className="err">
          Connect to {chainMetadata(CHAIN_ID).name} (chainId {CHAIN_ID}).
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

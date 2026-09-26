/**
 * JobsManager contract reads and writes.
 *
 * Reads use a viem public client over the injected wallet's transport (so no
 * RPC URL has to be configured client-side); writes go through the wallet via
 * `walletClient.writeContract`.
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  getAddress,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  CHAIN_ID,
  JOBS_MANAGER_ADDRESS,
  chainMetadata,
  hasContractAddress,
} from "./config";
import jobsManagerAbi from "./jobsManagerAbi.json";
import { getProvider, switchChain } from "./wallet";

export const jobsManagerAbiTyped = jobsManagerAbi as readonly unknown[];

/** Mirrors the Solidity `Jobs` struct (field names/order must match). */
export interface Job {
  jobHash: `0x${string}`;
  client: Address;
  startTime: number;
  creationTime: number;
  contractor: Address;
  duration: number;
  feeBP: number;
  closed: boolean;
  escrowed: boolean;
  asset: Address;
  amount: bigint;
  resolver: Address;
}

/** Mirrors the Solidity `Stake` struct. */
export interface Stake {
  stakedAsset: Address;
  stakedAmount: bigint;
}

/** Thrown when the contract address is not configured at build time. */
export class MissingContractError extends Error {
  constructor() {
    super(
      "コントラクトアドレスが設定されていません。PUBLIC_JOBS_MANAGER_ADDRESS を設定してください。",
    );
    this.name = "MissingContractError";
  }
}

export function requireContractAddress(): Address {
  if (!hasContractAddress()) {
    throw new MissingContractError();
  }
  return getAddress(JOBS_MANAGER_ADDRESS as string);
}

/** Public client backed by the wallet's JSON-RPC transport. */
export function getPublicClient(): PublicClient {
  const provider = getProvider();
  return createPublicClient({
    transport: custom(provider),
  }) as unknown as PublicClient;
}

/** Wallet client backed by the injected provider. */
export async function getWalletClient(): Promise<WalletClient> {
  const provider = getProvider();
  const [account] = (await provider.request({
    method: "eth_requestAccounts",
  })) as Address[];
  return createWalletClient({
    account,
    transport: custom(provider),
  });
}

/**
 * Ensures the wallet is on `CHAIN_ID`, requesting a switch when needed.
 * Returns `true` when the wallet is ready, `false` when the chain is unknown
 * to the wallet (the caller should surface an actionable message).
 */
export async function ensureChain(): Promise<boolean> {
  try {
    return await switchChain(CHAIN_ID);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function readClientStaked(client: Address): Promise<boolean> {
  const address = requireContractAddress();
  const publicClient = getPublicClient();
  return (await publicClient.readContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "clientStaked",
    args: [client],
  })) as boolean;
}

export async function readClientStake(client: Address): Promise<Stake> {
  const address = requireContractAddress();
  const publicClient = getPublicClient();
  const result = (await publicClient.readContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "clientStake",
    args: [client],
  })) as { stakedAsset: Address; stakedAmount: bigint };
  return result;
}

/** Returns the IDs of every job a client has ever created. */
export async function readClientJobIds(client: Address): Promise<bigint[]> {
  const address = requireContractAddress();
  const publicClient = getPublicClient();
  return (await publicClient.readContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "clientJobs",
    args: [client],
  })) as bigint[];
}

export async function readJob(jobId: bigint): Promise<Job> {
  const address = requireContractAddress();
  const publicClient = getPublicClient();
  const result = (await publicClient.readContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "jobs",
    args: [jobId],
  })) as Job;
  return result;
}

/** Reads every job for a client, preserving the order they were created. */
export async function readClientJobs(client: Address): Promise<Job[]> {
  const ids = await readClientJobIds(client);
  return Promise.all(ids.map((id) => readJob(id)));
}

export async function readProtocolFeeBP(): Promise<number> {
  const address = requireContractAddress();
  const publicClient = getPublicClient();
  return Number(
    (await publicClient.readContract({
      address,
      abi: jobsManagerAbiTyped,
      functionName: "protocolFeeBP",
    })) as bigint,
  );
}

export async function readStakeRequirement(asset: Address): Promise<bigint> {
  const address = requireContractAddress();
  const publicClient = getPublicClient();
  return (await publicClient.readContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "stakeRequirement",
    args: [asset],
  })) as bigint;
}

export async function readIsSupportedAsset(asset: Address): Promise<boolean> {
  const address = requireContractAddress();
  const publicClient = getPublicClient();
  return (await publicClient.readContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "isSupportedAsset",
    args: [asset],
  })) as boolean;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Calls `registerAndStake(asset, data)`.
 *
 * `data` is the opaque bytes consumed by the World ID verification library
 * (nullifier + bounded EOA + service signature for the off-chain flow).
 */
export async function registerAndStake(
  asset: Address,
  data: `0x${string}`,
): Promise<`0x${string}`> {
  const address = requireContractAddress();
  const walletClient = await getWalletClient();
  const account = walletClient.account!;
  return walletClient.writeContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "registerAndStake",
    args: [asset, data],
    account,
    chain: null,
  });
}

/** Calls `unregisterAndUnstake()`. */
export async function unregisterAndUnstake(): Promise<`0x${string}`> {
  const address = requireContractAddress();
  const walletClient = await getWalletClient();
  const account = walletClient.account!;
  return walletClient.writeContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "unregisterAndUnstake",
    account,
    chain: null,
  });
}

export interface CreateJobParams {
  jobHash: `0x${string}`;
  asset: Address;
  amount: bigint;
  duration: number;
  resolver: Address;
}

/** Calls `createJob(...)`. Returns the new job ID decoded from the event. */
export async function createJob(
  params: CreateJobParams,
): Promise<{ hash: `0x${string}`; jobId: bigint | null }> {
  const address = requireContractAddress();
  const walletClient = await getWalletClient();
  const account = walletClient.account!;

  const hash = await walletClient.writeContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "createJob",
    args: [
      params.jobHash,
      params.asset,
      params.amount,
      params.duration,
      params.resolver,
    ],
    account,
    chain: null,
  });

  // Wait for the receipt to decode the JobCreated event and get the job ID.
  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: jobsManagerAbiTyped,
        eventName: "JobCreated",
        data: log.data,
        topics: log.topics,
      });
      return { hash, jobId: (decoded.args as { jobId: bigint }).jobId };
    } catch {
      // Not a JobCreated log; keep looking.
    }
  }

  return { hash, jobId: null };
}

/** Calls `nominateContractor(jobId, contractor)`. */
export async function nominateContractor(
  jobId: bigint,
  contractor: Address,
): Promise<`0x${string}`> {
  const address = requireContractAddress();
  const walletClient = await getWalletClient();
  const account = walletClient.account!;
  return walletClient.writeContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "nominateContractor",
    args: [jobId, contractor],
    account,
    chain: null,
  });
}

/** Calls `closeJob(jobId, data)`. */
export async function closeJob(
  jobId: bigint,
  data: `0x${string}` = "0x",
): Promise<`0x${string}`> {
  const address = requireContractAddress();
  const walletClient = await getWalletClient();
  const account = walletClient.account!;
  return walletClient.writeContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "closeJob",
    args: [jobId, data],
    account,
    chain: null,
  });
}

/** Calls `acceptJob(jobId)`. */
export async function acceptJob(jobId: bigint): Promise<`0x${string}`> {
  const address = requireContractAddress();
  const walletClient = await getWalletClient();
  const account = walletClient.account!;
  return walletClient.writeContract({
    address,
    abi: jobsManagerAbiTyped,
    functionName: "acceptJob",
    args: [jobId],
    account,
    chain: null,
  });
}

export { chainMetadata };

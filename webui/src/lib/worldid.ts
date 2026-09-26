/**
 * Client-side helpers for the World ID verifier worker.
 *
 * The verifier owns the RP signing key and talks to the World ID Developer
 * Portal. This module only performs the two browser-facing calls:
 *
 *   1. `POST {verifier}/rp-signature` — obtain an RP context for IDKit.
 *   2. `POST {verifier}/verify`       — verify the completed IDKit result and
 *      receive a signed receipt.
 *
 * The exact `data` bytes accepted by `JobsManager.registerAndStake` depend on
 * which verification path the contract uses (on-chain verifier vs. the
 * off-chain `trustedServiceVerifier`). We build the off-chain layout here:
 *
 *   | offset | length | field                                  |
 *   |--------|--------|----------------------------------------|
 *   | 0      | 32     | World ID nullifier                     |
 *   | 32     | 20     | bounded EOA (the connected wallet)     |
 *   | 52     | 65     | ECDSA signature over the RP message    |
 *
 * When the verifier returns a `serviceSignature`/`nullifier`, that is used
 * directly. Otherwise the UI cannot produce valid calldata and reports a
 * clear, actionable error instead of sending a transaction that would revert.
 */
import { VERIFIER_URL, WORLD_RP_ID, WORLD_ACTION } from "./config";

export interface RpSignature {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
}

export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

export interface VerifySuccess {
  ok: true;
  signer: string;
  algorithm: string;
  signature: string;
  payload: unknown;
  /** Optional fields the verifier may return for contract calldata. */
  nullifier?: string | null;
  serviceSignature?: string | null;
  /** Address of the key stored as `trustedServiceVerifier` on the contract. */
  serviceSigner?: string;
}

export interface VerifyFailure {
  ok: false;
  error?: string;
  stage?: string;
  reason?: string;
  detail?: string | null;
  code?: string | null;
  portal?: unknown;
  request?: unknown;
}

export type VerifyResponse = VerifySuccess | VerifyFailure;

/** Fetches an RP signature for `action` from the verifier. */
export async function fetchRpContext(
  action: string = WORLD_ACTION,
  verifierUrl: string = VERIFIER_URL,
): Promise<RpContext> {
  const response = await fetch(`${verifierUrl}/rp-signature`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `RP 署名の取得に失敗しました (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const data = (await response.json()) as Partial<RpSignature>;
  if (!data.sig || !data.nonce || !data.created_at || !data.expires_at) {
    throw new Error("RP 署名のレスポンス形式が不正です");
  }

  return {
    rp_id: WORLD_RP_ID,
    nonce: data.nonce,
    created_at: data.created_at,
    expires_at: data.expires_at,
    signature: data.sig,
  };
}

/** Verifies a completed IDKit result with the verifier worker. */
export async function verifyIdkitResult(
  idkitResponse: unknown,
  address?: `0x${string}`,
  verifierUrl: string = VERIFIER_URL,
): Promise<VerifySuccess> {
  let response: Response;
  try {
    response = await fetch(`${verifierUrl}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idkitResponse, address }),
    });
  } catch (cause) {
    throw new Error(
      `verifier に接続できませんでした (${verifierUrl})。ネットワークと CORS を確認してください。`,
      { cause },
    );
  }

  const data = (await response.json().catch(() => null)) as VerifyResponse | null;
  if (!data) {
    throw new Error(
      `verifier のレスポンスを解析できませんでした (HTTP ${response.status})`,
    );
  }

  if (!data.ok) {
    const code = data.code ? ` [${data.code}]` : "";
    const reason = data.reason ? ` (${data.reason})` : "";
    const stage = data.stage ? ` @${data.stage}` : "";
    const detail = data.detail ?? data.error ?? "unknown error";
    const error = new Error(
      `バックエンド検証に失敗しました${code}${reason}${stage}: ${detail}`,
    );
    (error as Error & { detail?: unknown }).detail = data;
    throw error;
  }

  return data;
}

function strip0x(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function pad32(hexWithout0x: string): string {
  return hexWithout0x.padStart(64, "0").slice(-64);
}

/**
 * Builds `data` for `registerAndStake` from a verifier receipt.
 *
 * Returns `null` when the verifier did not return the fields required by the
 * off-chain verification path (`nullifier` + `serviceSignature`), so the caller
 * can surface an explanatory error instead of sending a reverting tx.
 */
export function buildRegisterData(
  receipt: VerifySuccess,
  walletAddress: `0x${string}`,
): `0x${string}` | null {
  if (!receipt.nullifier || !receipt.serviceSignature) {
    return null;
  }

  const nullifier = pad32(strip0x(receipt.nullifier));
  const eoa = strip0x(walletAddress).toLowerCase().padStart(40, "0");
  const signature = strip0x(receipt.serviceSignature);

  return `0x${nullifier}${eoa}${signature}` as `0x${string}`;
}

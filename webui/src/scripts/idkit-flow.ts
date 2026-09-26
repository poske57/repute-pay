/**
 * World ID 4.0 verification flow for the browser.
 *
 * This module is bundled by Astro and runs on the client. It uses the plain
 * `@worldcoin/idkit-core` SDK (no framework component) to:
 *
 *   1. Fetch an RP signature from the verifier worker.
 *   2. Build an IDKit request with that RP context.
 *   3. Render the connector URI as a QR code.
 *   4. Poll until the user completes the flow in World App.
 *   5. Forward the resulting IDKit payload to the verifier for backend
 *      verification.
 *
 * See:
 *  - https://docs.world.org/world-id/idkit/integrate.md
 *  - https://docs.world.org/world-id/idkit/javascript.md
 *  - https://docs.world.org/world-id/idkit/error-codes.md
 */
import {
  IDKit,
  IDKitErrorCodes,
  proofOfHuman,
  setDebug,
  type IDKitCompletionResult,
  type IDKitDebugReport,
  type IDKitRequest,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit-core";

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Default verifier base URL. Overridable with PUBLIC_VERIFIER_URL at build time,
 * and at runtime via the `verifier URL` input on the page.
 */
const DEFAULT_VERIFIER_URL = (
  import.meta.env.PUBLIC_VERIFIER_URL ?? "http://127.0.0.1:8787"
).replace(/\/+$/, "");

/** Removes trailing slashes so paths can be appended safely. */
function normalizeVerifierUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** Must match the verifier's WORLD_ACTION. */
const DEFAULT_ACTION = "register";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

const isDevBuild = import.meta.env.DEV;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type FlowState =
  | "idle"
  | "requesting-signature"
  | "waiting"
  | "verifying"
  | "verified"
  | "error";

interface RpSignatureResponse {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
}

interface VerifySuccessResponse {
  ok: true;
  signer: string;
  algorithm: string;
  signature: string;
  payload: unknown;
}

interface VerifyFailureResponse {
  ok: false;
  error?: string;
  world?: unknown;
  detail?: string | null;
  code?: string | null;
}

type VerifyResponse = VerifySuccessResponse | VerifyFailureResponse;

/* -------------------------------------------------------------------------- */
/* Human-readable messages                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Messages recommended by the Error Codes docs. Keys are IDKitErrorCodes values.
 *
 * @see https://docs.world.org/world-id/idkit/error-codes.md
 */
const ERROR_MESSAGES: Record<string, { title: string; hint: string; terminal?: boolean }> = {
  [IDKitErrorCodes.UserRejected]: {
    title: "リクエストがキャンセルされました",
    hint: "World App でキャンセルされました。もう一度お試しください。",
  },
  [IDKitErrorCodes.VerificationRejected]: {
    title: "リクエストがキャンセルされました",
    hint: "World App でキャンセルされました。もう一度お試しください。",
  },
  [IDKitErrorCodes.CredentialUnavailable]: {
    title: "この認証情報を利用できません",
    hint: "要求した認証情報がこのユーザーにはありません。別の認証情報を案内してください。",
    terminal: true,
  },
  [IDKitErrorCodes.WorldId4NotAvailable]: {
    title: "World ID 4.0 を利用できません",
    hint: "このユーザーは World ID 4.0 の認証情報を持っていません。互換のあるフォールバックが必要です。",
    terminal: true,
  },
  [IDKitErrorCodes.WorldId3NotAvailable]: {
    title: "World ID 3.0 を利用できません",
    hint: "このユーザーは World ID 3.0 の認証情報を持っていません。互換のあるフォールバックが必要です。",
    terminal: true,
  },
  [IDKitErrorCodes.MalformedRequest]: {
    title: "リクエストが不正です",
    hint: "app_id / rp_context / action の設定を確認してください。",
  },
  [IDKitErrorCodes.InvalidNetwork]: {
    title: "環境が一致しません",
    hint: "environment（production / staging）と World App の接続先を揃えてください。",
  },
  [IDKitErrorCodes.InclusionProofPending]: {
    title: "証明データの準備中です",
    hint: "しばらく待ってから再試行してください。",
  },
  [IDKitErrorCodes.InclusionProofFailed]: {
    title: "証明データの取得に失敗しました",
    hint: "再試行してください。繰り返す場合は運用インシデントとして扱ってください。",
  },
  [IDKitErrorCodes.UnexpectedResponse]: {
    title: "予期しない応答を受信しました",
    hint: "診断情報を記録して、もう一度試してください。",
  },
  [IDKitErrorCodes.ConnectionFailed]: {
    title: "接続に失敗しました",
    hint: "ネットワーク接続とブリッジへの到達性を確認してください。",
  },
  [IDKitErrorCodes.MaxVerificationsReached]: {
    title: "このアクションは上限に達しています",
    hint: "このアクションはこれ以上検証できません。再試行しても同じ結果になります。",
    terminal: true,
  },
  [IDKitErrorCodes.FailedByHostApp]: {
    title: "バックエンド検証に失敗しました",
    hint: "host アプリ側の検証が拒否しました。バックエンドのレスポンスを確認してください。",
  },
  [IDKitErrorCodes.UserPresenceFailed]: {
    title: "ユーザー確認に失敗しました",
    hint: "ユーザーにもう一度試してもらってください。",
  },
  [IDKitErrorCodes.InvalidRpSignature]: {
    title: "RP 署名が無効です",
    hint: "RP 署名鍵・nonce・タイムスタンプ・action を確認してください。",
  },
  [IDKitErrorCodes.NullifierReplayed]: {
    title: "検証済みです",
    hint: "このアクションはすでに検証済みです。新しい検証として再試行しないでください。",
    terminal: true,
  },
  [IDKitErrorCodes.DuplicateNonce]: {
    title: "nonce が再利用されました",
    hint: "リクエストごとに新しい nonce と RP 署名を生成してください。",
  },
  [IDKitErrorCodes.UnknownRp]: {
    title: "RP が登録されていません",
    hint: "登録済みの rp_id とアプリ設定を確認してください。",
    terminal: true,
  },
  [IDKitErrorCodes.InactiveRp]: {
    title: "RP が無効です",
    hint: "再試行する前に RP を有効化・再設定してください。",
    terminal: true,
  },
  [IDKitErrorCodes.TimestampTooOld]: {
    title: "署名のタイムスタンプが古すぎます",
    hint: "新しい RP 署名を取得してやり直してください。",
  },
  [IDKitErrorCodes.TimestampTooFarInFuture]: {
    title: "署名のタイムスタンプが未来すぎます",
    hint: "サーバーの時計ずれを修正し、新しい RP 署名を取得してください。",
  },
  [IDKitErrorCodes.InvalidTimestamp]: {
    title: "タイムスタンプが無効です",
    hint: "タイムスタンプの形式を確認し、RP 署名を再生成してください。",
  },
  [IDKitErrorCodes.RpSignatureExpired]: {
    title: "RP 署名の有効期限が切れました",
    hint: "検証を開始する前に新しい RP 署名を取得してください。",
  },
  [IDKitErrorCodes.IdentityAttributesNotMatched]: {
    title: "本人属性が条件に一致しません",
    hint: "対象外のユーザーです。条件を見直すか、案内を表示してください。",
    terminal: true,
  },
  [IDKitErrorCodes.GenericError]: {
    title: "不明なエラーが発生しました",
    hint: "詳細を記録し、時間をおいて再試行してください。",
  },
  [IDKitErrorCodes.InvalidRpIdFormat]: {
    title: "rp_id の形式が不正です",
    hint: "app 設定の登録済み rp_... ID を使用してください。",
    terminal: true,
  },
  [IDKitErrorCodes.Timeout]: {
    title: "タイムアウトしました",
    hint: "時間内に証明を取得できませんでした。もう一度お試しください。",
  },
  [IDKitErrorCodes.Cancelled]: {
    title: "キャンセルされました",
    hint: "リクエストがキャンセルされました。もう一度お試しください。",
  },
};

function describeErrorCode(code: string): { title: string; hint: string; terminal: boolean } {
  const known = ERROR_MESSAGES[code];
  if (known) {
    return { ...known, terminal: known.terminal ?? false };
  }
  return {
    title: `エラー: ${code}`,
    hint: "詳細を確認して再試行してください。",
    terminal: false,
  };
}

/* -------------------------------------------------------------------------- */
/* DOM helpers                                                                */
/* -------------------------------------------------------------------------- */

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`missing element #${id}`);
  }
  return el as T;
}

/** Renders a QR code for `text` into the given canvas. */
async function renderQr(canvas: HTMLCanvasElement, text: string): Promise<void> {
  const QRCode = (await import("qrcode")).default;
  await QRCode.toCanvas(canvas, text, { width: 280, margin: 2 });
}

/* -------------------------------------------------------------------------- */
/* Flow                                                                       */
/* -------------------------------------------------------------------------- */

export function initVerificationFlow(): void {
  const form = $<HTMLFormElement>("verify-form");
  const verifierUrlInput = $<HTMLInputElement>("verifier-url");
  const appIdInput = $<HTMLInputElement>("app-id");
  const rpIdInput = $<HTMLInputElement>("rp-id");
  const actionInput = $<HTMLInputElement>("action");
  const environmentSelect = $<HTMLSelectElement>("environment");

  const startButton = $<HTMLButtonElement>("start-button");
  const resetButton = $<HTMLButtonElement>("reset-button");

  const statusPanel = $<HTMLDivElement>("status-panel");
  const statusLabel = $<HTMLSpanElement>("status-label");
  const qrSection = $<HTMLDivElement>("qr-section");
  const qrCanvas = $<HTMLCanvasElement>("qr-canvas");
  const connectLink = $<HTMLAnchorElement>("connect-link");
  const spinner = $<HTMLDivElement>("spinner");
  const messageBox = $<HTMLDivElement>("message-box");
  const resultSection = $<HTMLDivElement>("result-section");
  const resultJson = $<HTMLPreElement>("result-json");
  const debugSection = $<HTMLDivElement>("debug-section");
  const debugJson = $<HTMLPreElement>("debug-json");
  const errorSection = $<HTMLDivElement>("error-section");
  const errorTitle = $<HTMLHeadingElement>("error-title");
  const errorHint = $<HTMLParagraphElement>("error-hint");
  const errorDetail = $<HTMLPreElement>("error-detail");

  // Default values come from query params (handy for repeat runs) or defaults.
  const params = new URLSearchParams(window.location.search);
  verifierUrlInput.value = params.get("verifier_url") ?? verifierUrlInput.value ?? DEFAULT_VERIFIER_URL;
  appIdInput.value = params.get("app_id") ?? appIdInput.value;
  rpIdInput.value = params.get("rp_id") ?? rpIdInput.value;
  actionInput.value = params.get("action") ?? DEFAULT_ACTION;

  /** Current verifier base URL, taken from the input (falling back to the default). */
  function currentVerifierUrl(): string {
    return normalizeVerifierUrl(verifierUrlInput.value) || DEFAULT_VERIFIER_URL;
  }

  let currentRequest: IDKitRequest | null = null;
  let abortController: AbortController | null = null;

  function setState(state: FlowState): void {
    statusPanel.dataset.state = state;
    statusLabel.textContent = {
      idle: "待機中",
      "requesting-signature": "RP 署名を取得中…",
      waiting: "World App での承認待ち…",
      verifying: "バックエンドで検証中…",
      verified: "検証成功",
      error: "エラー",
    }[state];

    qrSection.hidden = state !== "waiting";
    spinner.hidden = !(state === "requesting-signature" || state === "waiting" || state === "verifying");
    messageBox.hidden = state === "idle" || state === "verified" || state === "error";

    startButton.disabled =
      state === "requesting-signature" || state === "waiting" || state === "verifying";
  }

  function showError(title: string, hint: string, detail?: unknown): void {
    errorSection.hidden = false;
    errorTitle.textContent = title;
    errorHint.textContent = hint;
    errorDetail.textContent = detail === undefined ? "" : JSON.stringify(detail, null, 2);
    errorDetail.hidden = detail === undefined;
    setState("error");
  }

  function clearError(): void {
    errorSection.hidden = true;
    errorTitle.textContent = "";
    errorHint.textContent = "";
    errorDetail.textContent = "";
  }

  function showResult(data: VerifySuccessResponse): void {
    resultSection.hidden = false;
    resultJson.textContent = JSON.stringify(data, null, 2);
  }

  function clearResult(): void {
    resultSection.hidden = true;
    resultJson.textContent = "";
  }

  function showDebug(report: IDKitDebugReport): void {
    if (!isDevBuild) {
      return;
    }
    debugSection.hidden = false;
    debugJson.textContent = JSON.stringify(report, null, 2);
  }

  function clearDebug(): void {
    debugSection.hidden = true;
    debugJson.textContent = "";
  }

  async function fetchRpSignature(verifierUrl: string, action: string): Promise<RpSignatureResponse> {
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

    const data = (await response.json()) as Partial<RpSignatureResponse>;

    if (!data.sig || !data.nonce || !data.created_at || !data.expires_at) {
      throw new Error("RP 署名のレスポンス形式が不正です");
    }

    return data as RpSignatureResponse;
  }

  async function callVerify(
    verifierUrl: string,
    idkitResponse: IDKitResult,
  ): Promise<VerifySuccessResponse> {
    let response: Response;
    try {
      response = await fetch(`${verifierUrl}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idkitResponse }),
      });
    } catch (cause) {
      throw new Error(
        `verifier に接続できませんでした (${verifierUrl})。ネットワークと CORS を確認してください。`,
        { cause },
      );
    }

    const data = (await response.json().catch(() => null)) as VerifyResponse | null;

    if (!data) {
      throw new Error(`verifier のレスポンスを解析できませんでした (HTTP ${response.status})`);
    }

    if (!data.ok) {
      const code = data.code ? ` [${data.code}]` : "";
      const detail =
        data.detail ??
        (typeof data.world === "object" && data.world !== null
          ? JSON.stringify(data.world)
          : data.error ?? "unknown error");
      const err = new Error(`バックエンド検証に失敗しました${code}: ${detail}`);
      (err as Error & { detail?: unknown }).detail = data;
      throw err;
    }

    return data;
  }

  function handleCompletionFailure(completion: IDKitCompletionResult): void {
    if (completion.success) {
      return;
    }

    const code = String(completion.error);
    const info = describeErrorCode(code);

    const report = currentRequest?.getDebugReport();
    if (report) {
      showDebug(report);
    }

    showError(info.title, info.hint, { code, debug: report });
  }

  async function start(): Promise<void> {
    const verifierUrl = currentVerifierUrl();
    const appId = appIdInput.value.trim() as `app_${string}`;
    const rpId = rpIdInput.value.trim();
    const action = actionInput.value.trim() || DEFAULT_ACTION;
    const environment = environmentSelect.value as "production" | "staging";

    clearError();
    clearResult();
    clearDebug();

    try {
      const parsed = new URL(verifierUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      showError(
        "verifier URL が不正です",
        "http:// または https:// で始まる有効な URL を入力してください。",
      );
      return;
    }

    if (!appId.startsWith("app_")) {
      showError("app_id が不正です", "app_id は app_... の形式で入力してください。");
      return;
    }
    if (!rpId.startsWith("rp_")) {
      showError("rp_id が不正です", "rp_id は rp_... の形式で入力してください。");
      return;
    }

    setDebug(isDevBuild);
    abortController = new AbortController();

    try {
      // Step 1: RP signature from the verifier.
      setState("requesting-signature");
      const rpSig = await fetchRpSignature(verifierUrl, action);

      const rpContext: RpContext = {
        rp_id: rpId,
        nonce: rpSig.nonce,
        created_at: rpSig.created_at,
        expires_at: rpSig.expires_at,
        signature: rpSig.sig,
      };

      // Step 2: Build the IDKit request and finalize it with a preset.
      const request = await IDKit.request({
        app_id: appId,
        action,
        rp_context: rpContext,
        allow_legacy_proofs: true,
        environment,
      }).preset(proofOfHuman());

      currentRequest = request;

      // Step 3: Render the connector URI as a QR code.
      const connectorURI = request.connectorURI;
      connectLink.href = connectorURI;
      connectLink.textContent = connectorURI;

      if (connectorURI) {
        await renderQr(qrCanvas, connectorURI);
      }

      // Step 4: Wait for the user to complete the flow.
      setState("waiting");

      const completion = await request.pollUntilCompletion({
        pollInterval: POLL_INTERVAL_MS,
        timeout: POLL_TIMEOUT_MS,
        signal: abortController.signal,
      });

      if (!completion.success) {
        handleCompletionFailure(completion);
        return;
      }

      // Step 5: Forward the IDKit result to the verifier verbatim.
      setState("verifying");
      const verified = await callVerify(verifierUrl, completion.result);

      // Step 6: Show the verifier's signed response.
      showResult(verified);
      setState("verified");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        showError("キャンセルされました", "検証を中断しました。");
        return;
      }

      const err = cause as Error & { detail?: unknown };
      const report = currentRequest?.getDebugReport();
      if (report) {
        showDebug(report);
      }
      showError(err.message || "予期しないエラーが発生しました", "詳細を確認してください。", {
        detail: err.detail,
        debug: report,
      });
    }
  }

  function reset(): void {
    abortController?.abort();
    abortController = null;
    currentRequest = null;
    clearError();
    clearResult();
    clearDebug();
    connectLink.textContent = "";
    connectLink.removeAttribute("href");
    setState("idle");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void start();
  });

  resetButton.addEventListener("click", reset);

  setState("idle");

  // Expose for manual debugging in the browser console during development.
  if (isDevBuild) {
    (window as unknown as { idkitFlow?: unknown }).idkitFlow = {
      start,
      reset,
      currentVerifierUrl,
      DEFAULT_VERIFIER_URL,
    };
  }
}

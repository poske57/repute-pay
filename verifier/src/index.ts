import { Hono } from "hono";
import { cors } from "hono/cors";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex } from "viem";
import { signRequest } from "@worldcoin/idkit-core/signing";

type Env = {
  WORLD_RP_ID: string;
  WORLD_ACTION: string;
  /**
   * The RP signing key from the Developer Portal.
   * Never expose this to client-side code.
   */
  RP_SIGNING_KEY: `0x${string}`;
  /** Key used by this worker to sign verification receipts. */
  SIGNING_PRIVATE_KEY: `0x${string}`;
};

type RpSignatureRequest = {
  action?: string;
  ttl?: number;
};

type VerifyRequest = {
  /** The unmodified IDKit result returned by `request.pollUntilCompletion()`. */
  idkitResponse: unknown;
};

type WorldVerifyResponse = {
  success?: boolean;
  action?: string;
  nullifier?: string;
  results?: unknown[];
  code?: string;
  detail?: string;
  [key: string]: unknown;
};

/**
 * A single, human-readable reason why verification could have failed.
 *
 * The Developer Portal often returns a bare `{ success: false }` with no
 * `detail`/`code`, so we compute our own diagnosis from the request, the RP
 * context and the response before surfacing it to the client.
 */
type VerificationDiagnosis = {
  /** Machine-readable failure category. */
  reason: string;
  /** Human-readable explanation suitable for logs and the UI. */
  message: string;
  /** The HTTP status to return to the caller. */
  status: 400 | 401 | 404 | 502;
};

/**
 * Inspects an IDKit v4 result and the portal response to produce a specific
 * failure reason. Returns `null` when no obvious problem is found, in which
 * case the portal's own response is the best available explanation.
 */
function diagnoseVerificationFailure(
  result: IdkitV4Result,
  worldResult: WorldVerifyResponse | null,
  httpStatus: number
): VerificationDiagnosis | null {
  const portalCode = worldResult?.code ?? null;
  const portalDetail = worldResult?.detail ?? null;

  // The portal had something to say — prefer it over our own guess.
  if (portalCode || portalDetail) {
    return {
      reason: portalCode ?? "world_id_verification_failed",
      message: portalDetail ?? "The Developer Portal rejected the proof.",
      status: httpStatus >= 400 ? (httpStatus as 400 | 401 | 404 | 502) : 401,
    };
  }

  // The portal returned a non-JSON body (typically an HTML 403/Forbidden or 5xx
  // page). That means the request never reached the verification logic, so a
  // structural check of the payload would be misleading.
  if (worldResult === null) {
    if (httpStatus === 403) {
      return {
        reason: "portal_forbidden",
        message:
          `The Developer Portal returned 403 Forbidden. This usually means the ` +
          `configured WORLD_RP_ID is not authorized for this portal/environment. ` +
          `Confirm the app is migrated to World ID 4.0 and that the rp_id belongs ` +
          `to it.`,
        status: 401,
      };
    }

    return {
      reason: "portal_error_response",
      message:
        `The Developer Portal returned HTTP ${httpStatus} with a non-JSON body. ` +
        `The request likely did not reach the verification logic. Check the ` +
        `rp_id and environment, and retry.`,
      status: httpStatus >= 500 ? 502 : 401,
    };
  }

  const now = Math.floor(Date.now() / 1000);

  // Timestamps: expiry is checked against `expires_at_min` inside the proof.
  for (const response of result.responses) {
    if (typeof response.expires_at_min === "number" && response.expires_at_min < now) {
      return {
        reason: "proof_expired",
        message:
          `The proof expired at ${new Date(response.expires_at_min * 1000).toISOString()} ` +
          `(now ${new Date(now * 1000).toISOString()}). Re-run the flow to ` +
          `generate a fresh proof.`,
        status: 401,
      };
    }
  }

  // A `0x`-prefixed nullifier is expected. The `nil_...` prefix indicates the
  // raw bridge envelope leaked through instead of a normalized v4 result.
  for (const response of result.responses) {
    if (typeof response.nullifier === "string" && !response.nullifier.startsWith("0x")) {
      return {
        reason: "malformed_nullifier",
        message:
          `The nullifier "${response.nullifier}" is not 0x-prefixed. ` +
          `This looks like a raw bridge envelope, not a normalized v4 result.`,
        status: 400,
      };
    }
  }

  // A v4 proof is an array of compressed Groth16 elements + Merkle root.
  // A plain string here means the payload was not a v4 proof.
  for (const response of result.responses) {
    if (!Array.isArray(response.proof)) {
      return {
        reason: "malformed_proof",
        message:
          `The proof for "${response.identifier}" is not an array. ` +
          `Expected compressed Groth16 elements, got ${typeof response.proof}.`,
        status: 400,
      };
    }
    if (response.proof.length < 4) {
      return {
        reason: "malformed_proof",
        message:
          `The proof for "${response.identifier}" has ${response.proof.length} ` +
          `element(s); a v4 proof needs at least 4.`,
        status: 400,
      };
    }
  }

  // An action mismatch between the proof and the configured action is a
  // common cause of an unexplained rejection.
  if (result.action && !/^0x[0-9a-fA-F]+$/.test(result.action)) {
    return {
      reason: "malformed_action",
      message: `The action "${result.action}" is not a hex value.`,
      status: 400,
    };
  }

  // Nothing specific found; the portal simply said no.
  return {
    reason: "world_id_verification_failed",
    message:
      "The Developer Portal rejected the proof without providing a reason. " +
      "Check that rp_id, app_id, action and environment match the registered " +
      "app, and that RP_SIGNING_KEY is the key registered for this rp_id.",
    status: httpStatus >= 400 ? (httpStatus as 400 | 401 | 404 | 502) : 401,
  };
}

/**
 * Shape of an IDKit v4 result.
 *
 * Only v4 results may be sent to `POST /api/v4/verify/{rp_id}`. A v3 result
 * (or the raw bridge envelope) is rejected by the portal with a bare
 * `world_id_verification_failed` and no `detail`/`code`, so we check the
 * envelope *before* forwarding to surface a clearer error.
 */
type IdkitV4Result = {
  protocol_version: "4.0";
  nonce: string;
  action: string;
  responses: Array<{
    identifier: string;
    issuer_schema_id: number;
    proof: string[];
    nullifier: string;
    expires_at_min: number;
  }>;
  environment: string;
  [key: string]: unknown;
};

/**
 * Explains why `value` is not a valid IDKit v4 result.
 *
 * Returns `null` when the value is valid; otherwise returns a description of
 * the first problem found, so the caller can surface a specific error rather
 * than a generic "invalid result".
 */
function describeIdkitV4Issue(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return `Expected an object, got ${value === null ? "null" : typeof value}.`;
  }

  const result = value as Record<string, unknown>;

  if (result.protocol_version !== "4.0") {
    return (
      `protocol_version is ${JSON.stringify(result.protocol_version)}, expected "4.0". ` +
      `A missing protocol_version usually means a v3/legacy result or a raw ` +
      `bridge envelope was forwarded instead of a v4 result.`
    );
  }

  if (typeof result.nonce !== "string") {
    return `nonce is missing or not a string (got ${typeof result.nonce}).`;
  }

  if (typeof result.action !== "string") {
    return `action is missing or not a string (got ${typeof result.action}).`;
  }

  if (typeof result.environment !== "string") {
    return `environment is missing or not a string (got ${typeof result.environment}).`;
  }

  if (!Array.isArray(result.responses) || result.responses.length === 0) {
    return `responses must be a non-empty array (got ${JSON.stringify(result.responses)}).`;
  }

  for (let index = 0; index < result.responses.length; index += 1) {
    const item = result.responses[index];

    if (typeof item !== "object" || item === null) {
      return `responses[${index}] is not an object.`;
    }

    const response = item as Record<string, unknown>;

    if (typeof response.identifier !== "string") {
      return `responses[${index}].identifier is missing or not a string.`;
    }

    if (typeof response.issuer_schema_id !== "number") {
      return `responses[${index}].issuer_schema_id is missing or not a number.`;
    }

    if (!Array.isArray(response.proof)) {
      return (
        `responses[${index}].proof is not an array (got ${typeof response.proof}). ` +
        `World ID 4.0 proofs are arrays of compressed Groth16 elements; a string ` +
        `here indicates a v3/legacy proof or a raw bridge envelope.`
      );
    }

    if (response.proof.length < 4) {
      return `responses[${index}].proof has ${response.proof.length} element(s); at least 4 are required.`;
    }

    for (let element = 0; element < response.proof.length; element += 1) {
      if (typeof response.proof[element] !== "string") {
        return `responses[${index}].proof[${element}] is not a string.`;
      }
    }

    if (typeof response.nullifier !== "string") {
      return `responses[${index}].nullifier is missing or not a string.`;
    }

    if (typeof response.expires_at_min !== "number") {
      return `responses[${index}].expires_at_min is missing or not a number.`;
    }
  }

  return null;
}

const app = new Hono<{ Bindings: Env }>();

// Accept requests from any origin (the webui is served from a different
// origin than the verifier worker).
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const object = value as Record<string, unknown>;

  return `{${Object.keys(object)
    .sort()
    .map((key) => {
      return `${JSON.stringify(key)}:${stableJson(object[key])}`;
    })
    .join(",")}}`;
}

async function sha256Hex(value: string): Promise<`0x${string}`> {
  const data = new TextEncoder().encode(value);

  const digest = await crypto.subtle.digest("SHA-256", data);

  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `0x${hex}`;
}

app.get("/health", (c) => {
  return c.json({ ok: true });
});

/**
 * Generates an RP signature for an IDKit request.
 *
 * The client fetches this and passes the result as `rp_context`:
 *
 * ```ts
 * const rpSig = await fetch("/rp-signature", {
 *   method: "POST",
 *   headers: { "content-type": "application/json" },
 *   body: JSON.stringify({ action: "my-action" }),
 * }).then((r) => r.json());
 *
 * IDKit.request({
 *   app_id,
 *   action: "my-action",
 *   rp_context: {
 *     rp_id,
 *     nonce: rpSig.nonce,
 *     created_at: rpSig.created_at,
 *     expires_at: rpSig.expires_at,
 *     signature: rpSig.sig,
 *   },
 * });
 * ```
 *
 * The signing key never leaves the backend.
 */
app.post("/rp-signature", async (c) => {
  let body: RpSignatureRequest = {};

  try {
    body = await c.req.json<RpSignatureRequest>();
  } catch {
    // An empty body is fine; we fall back to the configured action below.
  }

  const action = body.action ?? c.env.WORLD_ACTION;

  if (!action) {
    return c.json(
      {
        ok: false,
        error: "action_required",
        detail: "action is required to sign a request",
      },
      400
    );
  }

  if (!c.env.RP_SIGNING_KEY) {
    return c.json(
      {
        ok: false,
        error: "rp_signing_key_missing",
        detail: "RP_SIGNING_KEY is not configured",
      },
      500
    );
  }

  try {
    const { sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex: c.env.RP_SIGNING_KEY,
      action,
      ttl: body.ttl,
    });

    return c.json({
      sig,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
    });
  } catch {
    return c.json(
      {
        ok: false,
        error: "rp_signature_failed",
      },
      500
    );
  }
});

/**
 * Verifies an IDKit result with the World ID Developer Portal.
 *
 * The complete IDKit result is forwarded verbatim to
 * `POST /api/v4/verify/{rp_id}` — do not remap response identifiers or
 * construct a legacy `verification_level`.
 */
app.post("/verify", async (c) => {
  let body: VerifyRequest;

  try {
    body = await c.req.json<VerifyRequest>();
  } catch {
    return c.json(
      {
        ok: false,
        error: "invalid_json",
      },
      400
    );
  }

  if (!body.idkitResponse) {
    return c.json(
      {
        ok: false,
        error: "idkitResponse is required",
      },
      400
    );
  }

  // Reject malformed/non-v4 payloads before forwarding. The portal answers
  // such requests with `success: false` and no `detail`/`code`, which is hard
  // to debug — fail early with the exact structural problem instead.
  const idkitIssue = describeIdkitV4Issue(body.idkitResponse);

  if (idkitIssue) {
    return c.json(
      {
        ok: false,
        error: "invalid_idkit_result",
        detail: idkitIssue,
        stage: "preflight",
      },
      400
    );
  }

  const idkitResult = body.idkitResponse as IdkitV4Result;

  // Record exactly what is being sent, so the response can echo it back and
  // the client can correlate a portal failure with the payload it submitted.
  const requestSummary = {
    rp_id: c.env.WORLD_RP_ID,
    verify_url: `https://developer.world.org/api/v4/verify/${c.env.WORLD_RP_ID}`,
    protocol_version: idkitResult.protocol_version,
    action: idkitResult.action,
    nonce: idkitResult.nonce,
    environment: idkitResult.environment,
    identifiers: idkitResult.responses.map((r) => ({
      identifier: r.identifier,
      issuer_schema_id: r.issuer_schema_id,
      nullifier_prefix: typeof r.nullifier === "string" ? r.nullifier.slice(0, 12) : null,
      proof_elements: Array.isArray(r.proof) ? r.proof.length : null,
      expires_at_min: r.expires_at_min,
    })),
    rp_signing_key_configured: Boolean(c.env.RP_SIGNING_KEY),
  };

  const verifyUrl =
    `https://developer.world.org/api/v4/verify/` +
    encodeURIComponent(c.env.WORLD_RP_ID);

  let response: Response;
  let rawBody = "";

  try {
    response = await fetch(verifyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      // Forward the IDKit result unchanged.
      body: JSON.stringify(body.idkitResponse),
    });
    rawBody = await response.text();
  } catch (cause) {
    return c.json(
      {
        ok: false,
        error: "world_id_api_unreachable",
        stage: "portal_request",
        detail: cause instanceof Error ? cause.message : String(cause),
        request: requestSummary,
      },
      502
    );
  }

  // Parse defensively: the portal may return a bare body or an HTML error
  // page, in which case `rawBody` is the only evidence we have.
  let worldResult: WorldVerifyResponse | null = null;

  if (rawBody) {
    try {
      worldResult = JSON.parse(rawBody) as WorldVerifyResponse;
    } catch {
      worldResult = null;
    }
  }

  if (!response.ok || worldResult?.success !== true) {
    const diagnosis = diagnoseVerificationFailure(
      idkitResult,
      worldResult,
      response.status
    )!;

    return c.json(
      {
        ok: false,
        error: "world_id_verification_failed",
        stage: "portal_verification",
        reason: diagnosis.reason,
        detail: diagnosis.message,
        // The portal's raw response and the exact request we sent, so nothing
        // is lost when the portal returns an opaque failure.
        portal: {
          status: response.status,
          statusText: response.statusText,
          code: worldResult?.code ?? null,
          detail: worldResult?.detail ?? null,
          body: worldResult ?? rawBody.slice(0, 2000),
        },
        request: requestSummary,
      },
      diagnosis.status
    );
  }

  const idkitResponseHash = keccak256(
    stringToHex(stableJson(body.idkitResponse))
  );

  const payload = {
    rpId: c.env.WORLD_RP_ID,
    verification: worldResult,
    idkitResponseHash,
    issuedAt: Math.floor(Date.now() / 1000),
  };

  const message = stableJson(payload);
  const digest = await sha256Hex(message);

  const account = privateKeyToAccount(c.env.SIGNING_PRIVATE_KEY);

  /*
   * secp256k1 + SHA-256 digest に対する ECDSA 署名。
   *
   * 返却値は r || s || v の Ethereum 形式の署名。
   */
  const signature = await account.sign({
    hash: digest,
  });

  return c.json({
    ok: true,
    signer: account.address,
    algorithm: "ECDSA-secp256k1-SHA256",
    signature,
    payload,
  });
});

export default app;

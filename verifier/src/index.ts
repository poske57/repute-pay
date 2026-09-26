import { Hono } from "hono";
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

const app = new Hono<{ Bindings: Env }>();

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

  if (!c.env.SIGNING_PRIVATE_KEY) {
    return c.json(
      {
        ok: false,
        error: "rp_signing_key_missing",
        detail: "SIGNING_PRIVATE_KEY is not configured",
      },
      500
    );
  }

  try {
    const { sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex: c.env.SIGNING_PRIVATE_KEY,
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

  const verifyUrl =
    `https://developer.world.org/api/v4/verify/` +
    encodeURIComponent(c.env.WORLD_RP_ID);

  let response: Response;

  try {
    response = await fetch(verifyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      // Forward the IDKit result unchanged.
      body: JSON.stringify(body.idkitResponse),
    });
  } catch {
    return c.json(
      {
        ok: false,
        error: "world_id_api_unreachable",
      },
      502
    );
  }

  const worldResult =
    (await response.json().catch(() => null)) as WorldVerifyResponse | null;

  if (!response.ok || worldResult?.success !== true) {
    const status = (response.status >= 400
      ? response.status
      : 401) as 400 | 401 | 404 | 502;

    return c.json(
      {
        ok: false,
        error: "world_id_verification_failed",
        world: worldResult,
        detail: worldResult?.detail ?? null,
        code: worldResult?.code ?? null,
      },
      status
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

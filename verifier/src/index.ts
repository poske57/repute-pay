import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex } from "viem";

type Env = {
  WORLD_RP_ID: string;
  SIGNING_PRIVATE_KEY: `0x${string}`;
};

type VerifyRequest = {
  idkitResponse: unknown;
};

type WorldVerifyResponse = {
  success?: boolean;
  nullifier_hash?: string;
  verification_level?: string;
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
      body: JSON.stringify({
        idkitResponse: body.idkitResponse,
      }),
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
    return c.json(
      {
        ok: false,
        error: "world_id_verification_failed",
        world: worldResult,
      },
      401
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


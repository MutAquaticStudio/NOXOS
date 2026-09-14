import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type SessionDigestKey = Readonly<{
  version: string;
  environment: "staging" | "production";
  bytes: Uint8Array;
}>;
export type StoredSessionDigest = Readonly<{
  policy: "HMAC-SHA3-256-KEYED-V1";
  keyVersion: string;
  environment: "staging" | "production";
  digest: string;
}>;

export function assertSha3Available(): void {
  if (
    createHash("sha3-256").update("").digest("hex") !==
    "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
  ) {
    throw new Error("Required SHA3 implementation unavailable.");
  }
}

/** S04.4.1 framing. Caller must separately validate/canonicalize non-secret JSON. */
export function frameDigestPayload(purpose: string, payload: Uint8Array): Buffer {
  if (typeof purpose !== "string" || !/^[\x21-\x7e]+$/.test(purpose))
    throw new Error("Invalid digest purpose.");
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(payload.byteLength));
  return Buffer.concat([Buffer.from(`noxos:v1:${purpose}\0`, "utf8"), length, payload]);
}

function validateKey(key: SessionDigestKey): void {
  if (
    !key ||
    typeof key.version !== "string" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(key.version) ||
    !["staging", "production"].includes(key.environment) ||
    !(key.bytes instanceof Uint8Array) ||
    key.bytes.byteLength < 32
  ) {
    throw new Error("Session key configuration unavailable.");
  }
}

function secretBytes(secret: string): Buffer {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new Error("Invalid opaque session.");
  }
  const bytes = Buffer.from(secret, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== secret) {
    throw new Error("Invalid opaque session.");
  }
  return bytes;
}

export function sessionSecretDigest(secret: string, key: SessionDigestKey): StoredSessionDigest {
  validateKey(key);
  return Object.freeze({
    policy: "HMAC-SHA3-256-KEYED-V1",
    keyVersion: key.version,
    environment: key.environment,
    digest: createHmac("sha3-256", key.bytes)
      .update(frameDigestPayload("application-session", secretBytes(secret)))
      .digest("hex")
  });
}

/** Return secret only to the server cookie writer, never JSON, logs or persistence. */
export function issueSessionSecret(key: SessionDigestKey) {
  validateKey(key);
  assertSha3Available();
  const secret = randomBytes(32).toString("base64url");
  return { secret, stored: sessionSecretDigest(secret, key) };
}

export function verifySessionSecret(
  secret: string,
  stored: StoredSessionDigest,
  key: SessionDigestKey
): boolean {
  try {
    if (
      !stored ||
      stored.policy !== "HMAC-SHA3-256-KEYED-V1" ||
      stored.keyVersion !== key.version ||
      stored.environment !== key.environment ||
      !/^[a-f0-9]{64}$/.test(stored.digest)
    )
      return false;
    const actual = sessionSecretDigest(secret, key);
    return timingSafeEqual(Buffer.from(actual.digest, "hex"), Buffer.from(stored.digest, "hex"));
  } catch {
    return false;
  }
}

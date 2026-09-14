import { createHmac, timingSafeEqual } from "node:crypto";
import { frameDigestPayload } from "./session-crypto.js";
import type { SessionDigestKey } from "./session-crypto.js";
import type { TenantSessionContext } from "./tenant-session.js";

/** Derived proof, not a session credential. Deliver through an authenticated,
 * no-store same-origin response; never URL parameters or persistent browser storage.
 * Call only with a context obtained from current server-side session validation.
 */
export function tenantCsrfProof(context: TenantSessionContext, key: SessionDigestKey): string {
  const fields = [
    key.environment,
    key.version,
    context.sessionId,
    context.actorId,
    context.tenantId,
    context.issuedHost,
    String(context.routingVersion),
    context.authorizationEpoch
  ];
  if (
    !["staging", "production"].includes(key.environment) ||
    !(key.bytes instanceof Uint8Array) ||
    key.bytes.byteLength < 32 ||
    fields.some((value) => typeof value !== "string" || value.length === 0) ||
    !Number.isSafeInteger(context.routingVersion) ||
    context.routingVersion < 1
  )
    throw new Error("CSRF configuration unavailable.");
  // Length-prefix every field to avoid delimiter collisions; separate purpose
  // from session lookup digests even when using the same protected key version.
  const payload = Buffer.concat(
    fields.map((value) => {
      const bytes = Buffer.from(value, "utf8");
      const length = Buffer.alloc(8);
      length.writeBigUInt64BE(BigInt(bytes.length));
      return Buffer.concat([length, bytes]);
    })
  );
  return createHmac("sha3-256", key.bytes)
    .update(frameDigestPayload("tenant-session-csrf", payload))
    .digest("base64url");
}

export function verifyTenantCsrfProof(
  supplied: string | undefined,
  context: TenantSessionContext,
  key: SessionDigestKey
): boolean {
  try {
    if (typeof supplied !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
    const bytes = Buffer.from(supplied, "base64url");
    if (bytes.length !== 32 || bytes.toString("base64url") !== supplied) return false;
    return timingSafeEqual(bytes, Buffer.from(tenantCsrfProof(context, key), "base64url"));
  } catch {
    return false;
  }
}

import { createHmac, randomBytes } from "node:crypto";
import {
  assertSha3Available,
  frameDigestPayload,
  type SessionDigestKey
} from "@nox-os/auth/server-session";
import type { createAuthFlowRepository } from "../../../packages/database/src/auth-flow-repository.js";
import type { AuthRateInput } from "../../../packages/database/src/auth-rate-store.js";
import type { TenantLoginService } from "./tenant-login-http.js";

type Dimension = "FLOW" | "IDENTIFIER" | "NETWORK";
type Entry = {
  tenantId: string;
  routingVersion: number;
  policyVersion: string;
  ratePolicyRef: string;
  requiredAssurance: "A1" | "A2" | "PHISHING_RESISTANT";
  budgets: Record<Dimension, { limit: number; windowSeconds: number }>;
};
const opaque = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** AUTH-001 composes the existing host, budget and flow stores. No provider call,
 * account lookup or session side effect. Origin/canonical JSON are enforced by
 * the HTTP adapter. Trusted network correlation must be supplied by the edge.
 */
export function createTenantLoginStart(options: {
  key: SessionDigestKey;
  returnPaths: readonly string[];
  resolveEntry(host: string): Promise<Entry | null>;
  rate: { consume(input: AuthRateInput): Promise<"ALLOW" | "THROTTLED"> };
  flows: Pick<ReturnType<typeof createAuthFlowRepository>, "start">;
}) {
  const source = options.key;
  if (
    !source ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(source.version) ||
    !["staging", "production"].includes(source.environment) ||
    !(source.bytes instanceof Uint8Array) ||
    source.bytes.length < 32 ||
    !options.returnPaths.length ||
    options.returnPaths.some((p) => !/^\/[^/\\?#]*$/.test(p))
  )
    throw Error("AUTH_CONFIGURATION_UNAVAILABLE");
  const key = { ...source, bytes: Buffer.from(source.bytes) };
  assertSha3Available();
  const keyed = (purpose: string, value: string) =>
    createHmac("sha3-256", key.bytes)
      .update(
        frameDigestPayload(
          purpose,
          Buffer.from(JSON.stringify({ environment: key.environment, realm: "TENANT", value }))
        )
      )
      .digest("hex");
  return async (
    input: Parameters<TenantLoginService["start"]>[0] & { networkDigest: string }
  ): Promise<Awaited<ReturnType<TenantLoginService["start"]>>> => {
    const entry = await options.resolveEntry(input.host);
    if (
      !entry ||
      !uuid.test(entry.tenantId) ||
      !Number.isSafeInteger(entry.routingVersion) ||
      entry.routingVersion < 1 ||
      !entry.policyVersion ||
      !entry.ratePolicyRef ||
      !["A1", "A2", "PHISHING_RESISTANT"].includes(entry.requiredAssurance)
    )
      throw Error("AUTH_ENTRY_UNAVAILABLE");
    const fields = input.fields;
    const cookies = (input.cookieHeader ?? "")
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.startsWith("__Host-noxos-auth="));
    const existing = cookies[0]?.slice(18);
    if (
      cookies.length > 1 ||
      (existing !== undefined && !opaque.test(existing)) ||
      !hex.test(input.networkDigest) ||
      !opaque.test(fields.clientFlowNonce ?? "") ||
      !hex.test(fields.requestDigest ?? "") ||
      fields.digestPolicyVersion !== "FIPS202-SHA3-256-DOMAIN-SEPARATED-V1" ||
      (fields.providerMethod !== undefined && fields.providerMethod !== "PASSWORD") ||
      typeof fields.identifier !== "string" ||
      !fields.identifier.isWellFormed() ||
      fields.identifier.length > 320
    )
      throw Error("AUTH_START_INVALID");
    const identifier = fields.identifier.trim().normalize("NFC").toLowerCase();
    const returnPath = fields.returnTo ?? options.returnPaths[0]!;
    if (identifier.length < 3 || !options.returnPaths.includes(returnPath))
      throw Error("AUTH_START_INVALID");
    const nonceDigest = keyed("authentication-start-nonce", fields.clientFlowNonce!);
    const identifierDigest = keyed("authentication-identifier", identifier);
    const values = {
      FLOW: nonceDigest,
      IDENTIFIER: identifierDigest,
      NETWORK: input.networkDigest
    };
    const budgets = (["FLOW", "IDENTIFIER", "NETWORK"] as const).map((d) => {
      const b = entry.budgets?.[d];
      if (
        !b ||
        !Number.isSafeInteger(b.limit) ||
        b.limit < 1 ||
        b.limit > 1000000 ||
        !Number.isSafeInteger(b.windowSeconds) ||
        b.windowSeconds < 1 ||
        b.windowSeconds > 3600
      )
        throw Error("AUTH_RATE_CONFIGURATION_UNAVAILABLE");
      return { dimension: d, digest: values[d], ...b };
    });
    const decision = await options.rate.consume({
      environment: key.environment,
      realm: "TENANT",
      policyRef: entry.ratePolicyRef,
      keyVersion: key.version,
      phase: "BEFORE_PROVIDER",
      budgets
    });
    if (decision !== "ALLOW") throw Error("AUTH_REQUEST_DENIED");
    // A fresh nonce always gets independent random bearer material. Existing
    // cookies may prove a replay but never become the secret of another flow.
    const secret = randomBytes(32).toString("base64url");
    const row = await options.flows.start({
      tenantId: entry.tenantId,
      host: input.host,
      environment: key.environment,
      routingVersion: entry.routingVersion,
      policyVersion: entry.policyVersion,
      requiredAssurance: entry.requiredAssurance,
      safeReturnPath: returnPath,
      keyVersion: key.version,
      requestDigest: fields.requestDigest!,
      clientNonceDigest: nonceDigest,
      identifierDigest,
      flowSecretDigest: keyed("authentication-flow", secret),
      ...(existing ? { existingFlowSecretDigest: keyed("authentication-flow", existing) } : {})
    });
    if (
      !uuid.test(row.id) ||
      !(row.expiresAt instanceof Date) ||
      !Number.isFinite(row.expiresAt.getTime())
    )
      throw Error("AUTH_FLOW_UNAVAILABLE");
    const expiresAt = row.expiresAt.getTime();
    if (row.created) {
      if (!row.proofMatches || row.state !== "INITIATED" || expiresAt <= Date.now())
        throw Error("AUTH_FLOW_UNAVAILABLE");
      return { flowId: row.id, secret, expiresAt, next: "PASSWORD" };
    }
    // Lost Set-Cookie response: reconcile ID only, not a recovered credential.
    // The client must explicitly begin a new nonce before any password attempt.
    return {
      flowId: row.id,
      expiresAt,
      next:
        !row.proofMatches || !existing || expiresAt <= Date.now()
          ? "RESTART_REQUIRED"
          : row.state === "INITIATED"
            ? "PASSWORD"
            : "ORIGINAL_RESULT"
    };
  };
}

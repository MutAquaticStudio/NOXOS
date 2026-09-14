import { createHmac, timingSafeEqual } from "node:crypto";
import {
  assertSha3Available,
  frameDigestPayload,
  type SessionDigestKey,
  type PasswordVerification
} from "@nox-os/auth/server-session";
import type { createAuthFlowRepository } from "../../../packages/database/src/auth-flow-repository.js";
import type { AuthRateInput } from "../../../packages/database/src/auth-rate-store.js";
import type { AuthSecurityEvent } from "../../../packages/database/src/auth-security-events.js";
import type { TenantLoginService } from "./tenant-login-http.js";

type Scope = Parameters<ReturnType<typeof createAuthFlowRepository>["claimProvider"]>[0];
type Dimension = "FLOW" | "IDENTIFIER" | "NETWORK" | "SUBJECT";
type Entry = {
  tenantId: string;
  routingVersion: number;
  policyVersion: string;
  ratePolicyRef: string;
  budgets: Record<Dimension, { limit: number; windowSeconds: number }>;
};
type Result = Awaited<ReturnType<TenantLoginService["complete"]>>;
type SafeEvent = AuthSecurityEvent;
const hex = /^[a-f0-9]{64}$/;
const opaque = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function equalDigest(a: unknown, b: string) {
  return (
    typeof a === "string" &&
    hex.test(a) &&
    hex.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  );
}

/** AUTH-002 server orchestration, not a second credential/session store.
 * The HTTP transport verifies canonical JSON, digest and origin first. Network
 * correlation must come from the trusted edge adapter, never an arbitrary header.
 * This is deliberately not installed as a route until all dependencies are real.
 */
export function createTenantLoginCompletion(options: {
  key: SessionDigestKey;
  resolveEntry(host: string): Promise<Entry | null>;
  flows: Pick<
    ReturnType<typeof createAuthFlowRepository>,
    "readCurrent" | "claimProvider" | "recordProvider"
  >;
  rate: { consume(input: AuthRateInput): Promise<"ALLOW" | "THROTTLED"> };
  provider: {
    verifyPassword(input: { identifier: string; password: string }): Promise<PasswordVerification>;
  };
  /** Must re-read/fence current protected role, risk and credential authority in
   * the same issuance transaction. A pre-provider snapshot is not sufficient.
   */
  commitWithCurrentAuthority(input: Scope): Promise<Result>;
  /** Durable, idempotent by flow/result. Session-issued event remains atomic
   * with the session in the issuer, not in this pre-commit event callback.
   */
  recordSecurityEvent(input: SafeEvent): Promise<void>;
}) {
  const source = options.key;
  if (
    !source ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(source.version) ||
    !["staging", "production"].includes(source.environment) ||
    !(source.bytes instanceof Uint8Array) ||
    source.bytes.length < 32 ||
    typeof options.commitWithCurrentAuthority !== "function" ||
    typeof options.recordSecurityEvent !== "function"
  )
    throw Error("AUTH_CONFIGURATION_UNAVAILABLE");
  // Copy protected key material once. Later mutation of caller config cannot
  // silently change the meaning of persisted digests within one request.
  const key = { ...source, bytes: Buffer.from(source.bytes) };
  assertSha3Available();
  function keyed(purpose: string, value: string) {
    return createHmac("sha3-256", key.bytes)
      .update(
        frameDigestPayload(
          purpose,
          Buffer.from(JSON.stringify({ environment: key.environment, realm: "TENANT", value }))
        )
      )
      .digest("hex");
  }
  return async (
    input: Parameters<TenantLoginService["complete"]>[0] & {
      networkDigest: string;
    }
  ): Promise<Result> => {
    const entry = await options.resolveEntry(input.host);
    if (
      !entry ||
      !uuid.test(entry.tenantId) ||
      !Number.isSafeInteger(entry.routingVersion) ||
      entry.routingVersion < 1 ||
      !entry.policyVersion ||
      !entry.ratePolicyRef
    )
      throw Error("AUTH_ENTRY_UNAVAILABLE");
    const fields = input.fields;
    const cookies = (input.cookieHeader ?? "")
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.startsWith("__Host-noxos-auth="));
    const secret = cookies[0]?.slice(18);
    if (
      cookies.length !== 1 ||
      !secret ||
      !opaque.test(secret) ||
      !hex.test(input.networkDigest) ||
      !uuid.test(fields.flowId ?? "") ||
      !opaque.test(fields.operationKey ?? "") ||
      !hex.test(fields.requestDigest ?? "") ||
      typeof fields.identifier !== "string" ||
      !fields.identifier.isWellFormed() ||
      fields.identifier.length > 320 ||
      typeof fields.password !== "string" ||
      !fields.password.length ||
      fields.password.length > 4096
    )
      throw Error("AUTH_COMPLETION_INVALID");
    const identifier = fields.identifier.trim().normalize("NFC").toLowerCase();
    if (identifier.length < 3 || identifier.length > 320) throw Error("AUTH_COMPLETION_INVALID");
    for (const dimension of ["FLOW", "IDENTIFIER", "NETWORK", "SUBJECT"] as const) {
      const b = entry.budgets?.[dimension];
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
    }
    const scope: Scope = {
      tenantId: entry.tenantId,
      host: input.host,
      environment: key.environment,
      flowId: fields.flowId!,
      flowSecretDigest: keyed("authentication-flow", secret),
      identifierDigest: keyed("authentication-identifier", identifier),
      operationDigest: keyed("authentication-completion-operation", fields.operationKey!),
      completionDigest: fields.requestDigest!
    };
    const event = (result: SafeEvent["result"]) =>
      options.recordSecurityEvent({
        flowId: scope.flowId,
        tenantId: scope.tenantId,
        host: scope.host,
        environment: key.environment,
        policyVersion: entry.policyVersion,
        flowSecretDigest: scope.flowSecretDigest,
        result
      });
    function assertFlow(row: Awaited<ReturnType<typeof options.flows.readCurrent>>) {
      if (
        !row ||
        row.id !== scope.flowId ||
        row.routing_version !== entry!.routingVersion ||
        row.policy_version !== entry!.policyVersion ||
        row.token_digest_key_version !== key.version ||
        !(row.expires_at instanceof Date) ||
        !Number.isFinite(row.expires_at.getTime()) ||
        row.expires_at.getTime() <= Date.now() ||
        !equalDigest(row.identifier_correlation_digest, scope.identifierDigest)
      )
        throw Error("AUTH_FLOW_UNAVAILABLE");
      if (
        row.complete_operation_digest !== null &&
        (!equalDigest(row.complete_operation_digest, scope.operationDigest) ||
          !equalDigest(row.complete_request_digest, scope.completionDigest))
      )
        throw Error("AUTH_COMPLETION_REPLAY_CONFLICT");
      return row;
    }
    const row = assertFlow(await options.flows.readCurrent(scope));
    const charge = (phase: AuthRateInput["phase"], values: Partial<Record<Dimension, string>>) =>
      options.rate.consume({
        environment: key.environment,
        realm: "TENANT",
        phase,
        policyRef: entry.ratePolicyRef,
        keyVersion: key.version,
        budgets: (Object.entries(values) as [Dimension, string][]).map(([dimension, digest]) => ({
          dimension,
          digest,
          ...entry.budgets[dimension]
        }))
      });
    if (
      (await charge("BEFORE_PROVIDER", {
        FLOW: scope.flowSecretDigest,
        IDENTIFIER: scope.identifierDigest,
        NETWORK: input.networkDigest
      })) !== "ALLOW"
    ) {
      await event("THROTTLED");
      return { kind: "DENIED" };
    }
    async function resume(current: typeof row): Promise<Result> {
      switch (current.state) {
        case "SESSION_ISSUED":
          return { kind: "ORIGINAL_RESULT" };
        case "STEP_UP_REQUIRED":
          return { kind: "STEP_UP_REQUIRED" };
        case "PENDING_RECONCILIATION":
          await event("PENDING_RECONCILIATION");
          return { kind: "PENDING_RECONCILIATION" };
        case "FAILED_GENERIC":
          await event("DENIED");
          return { kind: "DENIED" };
        case "PRIMARY_VERIFIED":
        case "AUTHENTICATED":
          // Retry an audit outage before commit, never skip required telemetry.
          await event("PRIMARY_VERIFIED");
          return options.commitWithCurrentAuthority(scope);
        default:
          return { kind: "DENIED" };
      }
    }
    if (row.state !== "INITIATED") return resume(row);
    const claim = await options.flows.claimProvider(scope);
    if (!claim) return resume(assertFlow(await options.flows.readCurrent(scope)));
    let proof: PasswordVerification;
    try {
      proof = await options.provider.verifyPassword({ identifier, password: fields.password });
    } catch {
      proof = { kind: "PENDING_RECONCILIATION" };
    }
    if (proof.kind === "PENDING_RECONCILIATION") {
      await event("PENDING_RECONCILIATION");
      return proof;
    }
    if (proof.kind === "VERIFIED") {
      const project =
        key.environment === "staging" ? "uyfddpmbszjkhdkqvncz" : "soioshmcdwxhlgrjzkoc";
      if (
        proof.environment !== key.environment ||
        proof.providerKey !== "supabase" ||
        proof.issuer !== `https://${project}.supabase.co/auth/v1` ||
        !uuid.test(proof.subject) ||
        proof.assurance !== "A1"
      )
        throw Error("AUTH_PROVIDER_ENVIRONMENT_MISMATCH");
      // Record verified proof only AFTER the subject budget succeeds. An outage
      // leaves the durable claim pending, so retry cannot bypass this budget.
      if (
        (await charge("VERIFIED_SUBJECT", {
          SUBJECT: keyed("authentication-subject", JSON.stringify([proof.issuer, proof.subject]))
        })) !== "ALLOW"
      ) {
        await options.flows.recordProvider({
          ...scope,
          operationId: claim.operationId,
          result: { kind: "DENIED" }
        });
        await event("THROTTLED");
        return { kind: "DENIED" };
      }
    }
    const recorded = await options.flows.recordProvider({
      ...scope,
      operationId: claim.operationId,
      result: proof
    });
    if (!recorded) return { kind: "PENDING_RECONCILIATION" };
    if (proof.kind === "DENIED") {
      await event("DENIED");
      return proof;
    }
    await event("PRIMARY_VERIFIED");
    return options.commitWithCurrentAuthority(scope);
  };
}

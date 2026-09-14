import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { frameDigestPayload } from "@nox-os/auth/server-session";

export type AuthSecurityEvent = {
  flowId: string;
  tenantId: string;
  host: string;
  environment: "staging" | "production";
  policyVersion: string;
  flowSecretDigest: string;
  result: "THROTTLED" | "DENIED" | "PENDING_RECONCILIATION" | "PRIMARY_VERIFIED";
};
/** One safe outcome event per flow/class. Replays recover the same event, while
 * rate counters retain attempt counts. Never accepts actor/metadata from HTTP.
 * Session issuance owns its own atomic SESSION_ISSUED event in the same chain.
 */
export function createAuthSecurityEvents(sql: Sql) {
  return {
    async record(input: AuthSecurityEvent): Promise<void> {
      if (
        !/^[a-f0-9]{64}$/.test(input.flowSecretDigest) ||
        !["staging", "production"].includes(input.environment) ||
        !["THROTTLED", "DENIED", "PENDING_RECONCILIATION", "PRIMARY_VERIFIED"].includes(
          input.result
        )
      )
        throw Error("AUTH_EVENT_INVALID");
      await sql.begin(async (tx) => {
        await tx`select set_config('nox.tenant_id',${input.tenantId},true),
          set_config('nox.request_host',${input.host},true),set_config('nox.environment',${input.environment},true),
          set_config('nox.auth_flow_digest',${input.flowSecretDigest},true),set_config('nox.actor_id','',true),
          set_config('lock_timeout','2s',true),set_config('statement_timeout','5s',true)`;
        // Same chain serialization lock/order as the existing session issuer.
        const tenant =
          await tx`select id from platform.tenants where id=${input.tenantId} for update`;
        const flows = await tx`select id,policy_version,clock_timestamp() as current_time
          from platform.auth_flow where id=${input.flowId} for share`;
        if (
          tenant.length !== 1 ||
          flows.length !== 1 ||
          flows[0]!.policy_version !== input.policyVersion
        )
          throw Error("AUTH_EVENT_FLOW_UNAVAILABLE");
        const eventType = `AUTH_${input.result}`;
        const previousResult = await tx`select id,policy_version from platform.security_event
          where flow_id=${input.flowId} and event_type=${eventType}`;
        if (previousResult.length) {
          if (previousResult[0]!.policy_version !== input.policyVersion)
            throw Error("AUTH_EVENT_REPLAY_CONFLICT");
          return;
        }
        const previous = await tx`select sequence::text,event_digest from platform.security_event
          where tenant_id=${input.tenantId} order by sequence desc limit 1`;
        const sequence = (BigInt(previous[0]?.sequence ?? "0") + 1n).toString();
        const previousDigest = previous[0]?.event_digest ?? "0".repeat(64);
        const eventId = randomUUID(),
          now = flows[0]!.current_time as Date;
        const canonical = JSON.stringify({
          actorId: null,
          environment: input.environment,
          eventId,
          flowId: input.flowId,
          host: input.host,
          occurredAt: now.toISOString(),
          policyVersion: input.policyVersion,
          previousDigest,
          sequence,
          sessionId: null,
          tenantId: input.tenantId,
          type: eventType
        });
        const eventDigest = createHash("sha3-256")
          .update(frameDigestPayload("audit-event", Buffer.from(canonical)))
          .digest("hex");
        await tx`insert into platform.security_event(id,tenant_id,actor_id,flow_id,session_id,event_type,
          environment,issued_host,policy_version,sequence,previous_digest,event_digest,occurred_at)
          values (${eventId},${input.tenantId},null,${input.flowId},null,${eventType},${input.environment},
            ${input.host},${input.policyVersion},${sequence},${previousDigest},${eventDigest},${now})`;
        await tx`insert into nox_foundation.outbox(event_id,tenant_id,source,source_ref,source_version,
          payload_version,payload,occurred_at) values (${eventId},${input.tenantId},'G2_SECURITY',${input.flowId},
            1,1,${tx.json({ eventId, type: eventType })},${now})`;
      });
    }
  };
}

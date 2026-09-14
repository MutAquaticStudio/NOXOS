import { createHash, randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { acquireGuardFences } from "./guard-fence.js";
import {
  issueSessionSecret,
  frameDigestPayload,
  resolveLoginPolicy,
  resolveCurrentLoginAssurance,
  type CurrentLoginAssurance,
  type SessionDigestKey
} from "@nox-os/auth/server-session";

const assuranceRank: Record<string, number> = { A1: 1, A2: 2, PHISHING_RESISTANT: 3 };
export type ReadCurrentLoginAuthority = (
  tx: TransactionSql,
  current: Readonly<{
    tenantId: string;
    actorId: string;
    flowId: string;
    host: string;
    credentialEpoch: string;
    authorizationEpoch: string;
    providerIssuer: string;
    providerSubject: string;
    providerSessionId: string;
    policyVersion: string;
    detectionPolicyRef: string;
    returnPath: string;
  }>
) => Promise<CurrentLoginAssurance>;
/** Server-only commit seam. Does not call providers, grant roles, or serialize cookies into JSON. */
export function createAuthSessionIssuer(
  sql: Sql,
  key: SessionDigestKey,
  readCurrentAuthority: ReadCurrentLoginAuthority
) {
  // No implicit A1 lane when G2 protected-role/risk/credential storage is absent.
  // The installed adapter must use this transaction/fence, not a cached role or
  // a pre-provider snapshot. Network work belongs outside this commit seam.
  if (typeof readCurrentAuthority !== "function")
    throw Error("AUTH_CURRENT_AUTHORITY_NOT_INSTALLED");
  return {
    async issue(input: {
      flowId: string;
      tenantId: string;
      host: string;
      flowSecretDigest: string;
    }) {
      if (!/^[a-f0-9]{64}$/.test(input.flowSecretDigest)) throw Error("AUTH_FLOW_UNAVAILABLE");
      return sql.begin(async (tx) => {
        await acquireGuardFences(tx, [
          {
            scope: "PLATFORM",
            tenantId: null,
            ownerGate: "G2",
            objectType: "security_policy",
            objectId: "active-set",
            mode: "SHARED"
          }
        ]);
        await tx`select set_config('nox.tenant_id',${input.tenantId},true),
          set_config('nox.request_host',${input.host},true),set_config('nox.environment',${key.environment},true),
          set_config('nox.auth_flow_digest',${input.flowSecretDigest},true)`;
        // Stable lock order: policy-set fence, active policy rows, tenant (also event-chain serialization),
        // host, provider binding, actor, then flow. No network work while locks are held.
        const policies = await tx`select * from platform.security_policy_version
          where status='ACTIVE_VERSION' and (scope='PLATFORM_FLOOR' or tenant_id=${input.tenantId})
          order by scope,id for share`;
        const floor = policies.find((p) => p.scope === "PLATFORM_FLOOR");
        const tightening = policies.find((p) => p.scope === "TENANT_TIGHTENING");
        if (!floor || policies.length > 2) throw Error("AUTH_POLICY_UNAVAILABLE");
        const policyVersion = `${floor.id}:${floor.version}${tightening ? `|${tightening.id}:${tightening.version}` : ""}`;
        const { requiredRank, idleSeconds, absoluteSeconds } = resolveLoginPolicy(
          floor,
          tightening
        );
        const tenant =
          await tx`select status from platform.tenants where id=${input.tenantId} for update`;
        const hosts = await tx`select * from platform.tenant_host_registry
          where host_ascii=${input.host} and tenant_id=${input.tenantId} for share`;
        const preliminary = await tx`select * from platform.auth_flow where id=${input.flowId}`;
        if (
          tenant.length !== 1 ||
          tenant[0]!.status !== "ACTIVE" ||
          hosts.length !== 1 ||
          hosts[0]!.state !== "ACTIVE" ||
          hosts[0]!.route_kind !== "TENANT_CANONICAL" ||
          preliminary.length !== 1
        )
          throw Error("AUTH_FLOW_UNAVAILABLE");
        const before = preliminary[0]!;
        if (!before.verified_subject_ref || !before.verified_issuer)
          throw Error("AUTH_FLOW_UNVERIFIED");
        const projectRef =
          key.environment === "staging" ? "uyfddpmbszjkhdkqvncz" : "soioshmcdwxhlgrjzkoc";
        if (before.verified_issuer !== `https://${projectRef}.supabase.co/auth/v1`)
          throw Error("AUTH_PROVIDER_ENVIRONMENT_MISMATCH");
        // The installed provider lane is password-only. Do not synthesize stronger
        // assurance or a factor that has no verified adapter implementation.
        if (before.achieved_assurance !== "A1") throw Error("AUTH_ASSURANCE_PROVIDER_UNAVAILABLE");
        if (
          !floor.allowed_authenticator_classes.includes("PASSWORD") ||
          (tightening && !tightening.allowed_authenticator_classes.includes("PASSWORD"))
        )
          throw Error("AUTH_FACTOR_NOT_ALLOWED");
        await tx`select set_config('nox.verified_subject',${before.verified_subject_ref},true),
          set_config('nox.verified_issuer',${before.verified_issuer},true)`;
        const bindings =
          await tx`select * from platform.auth_principal_binding where tenant_id=${input.tenantId}
          and realm='TENANT' and provider_key='supabase' and issuer=${before.verified_issuer}
          and provider_subject=${before.verified_subject_ref} and state='ACTIVE' order by id for share`;
        if (bindings.length !== 1) throw Error("AUTH_BINDING_UNAVAILABLE");
        const binding = bindings[0]!;
        await tx`select set_config('nox.actor_id',${binding.actor_id},true)`;
        const actors = await tx`select * from platform.tenant_users
          where id=${binding.actor_id} and tenant_id=${input.tenantId} for share`;
        const flows = await tx`select *,clock_timestamp() as current_time from platform.auth_flow
          where id=${input.flowId} for update`;
        if (actors.length !== 1 || actors[0]!.state !== "ACTIVE" || flows.length !== 1)
          throw Error("AUTH_ACTOR_UNAVAILABLE");
        const flow = flows[0]!,
          actor = actors[0]!,
          host = hosts[0]!;
        const now = flow.current_time as Date;
        if (
          flow.environment !== key.environment ||
          flow.routing_version !== host.routing_version ||
          flow.verified_subject_ref !== before.verified_subject_ref ||
          flow.verified_issuer !== before.verified_issuer ||
          flow.policy_version !== policyVersion ||
          policies.some((p) => p.effective_at > now)
        )
          throw Error("AUTH_STATE_CHANGED");
        if (flow.state === "SESSION_ISSUED") {
          // The original secret is not recoverable from its digest. Status recovery
          // never creates a second session or upgrades to a fresh authenticated cookie.
          return { kind: "ORIGINAL_RESULT" as const, sessionId: String(flow.issued_session_id) };
        }
        if (flow.expires_at <= now || !["PRIMARY_VERIFIED", "AUTHENTICATED"].includes(flow.state))
          throw Error("AUTH_FLOW_UNAVAILABLE");
        const achieved = assuranceRank[flow.achieved_assurance];
        const currentAuthority = await readCurrentAuthority(
          tx,
          Object.freeze({
            tenantId: input.tenantId,
            actorId: String(actor.id),
            flowId: String(flow.id),
            host: input.host,
            credentialEpoch: String(actor.credential_epoch),
            authorizationEpoch: String(actor.authorization_epoch),
            providerIssuer: String(flow.verified_issuer),
            providerSubject: String(flow.verified_subject_ref),
            providerSessionId: String(flow.provider_session_ref),
            policyVersion,
            detectionPolicyRef: String((tightening ?? floor).detection_policy_ref),
            returnPath: String(flow.safe_return_path)
          })
        );
        const required = resolveCurrentLoginAssurance(
          requiredRank,
          String(flow.required_assurance),
          currentAuthority,
          String((tightening ?? floor).detection_policy_ref)
        );
        if (!achieved || achieved < required) {
          if (flow.state === "PRIMARY_VERIFIED")
            await tx`update platform.auth_flow
            set state='STEP_UP_REQUIRED',entity_version=entity_version+1 where id=${flow.id}`;
          return { kind: "STEP_UP_REQUIRED" as const };
        }
        if (flow.state === "PRIMARY_VERIFIED")
          await tx`update platform.auth_flow
          set state='AUTHENTICATED',entity_version=entity_version+1 where id=${flow.id}`;
        const issued = issueSessionSecret(key);
        const sessionId = randomUUID(),
          eventId = randomUUID();
        const idleExpiresAt = new Date(now.getTime() + idleSeconds * 1000);
        const absoluteExpiresAt = new Date(now.getTime() + absoluteSeconds * 1000);
        await tx`insert into platform.application_session(id,auth_operation_id,binding_id,actor_id,tenant_id,
          actor_kind,realm,mode,assurance,environment,secret_digest,token_digest_policy,token_digest_key_version,
          issued_host,routing_version_at_issue,credential_epoch,authorization_epoch,issued_at,
          last_authoritative_activity_at,idle_expires_at,absolute_expires_at,state)
          values (${sessionId},${flow.id},${binding.id},${actor.id},${input.tenantId},'TENANT_USER','TENANT','NORMAL',
          ${flow.achieved_assurance},${key.environment},${issued.stored.digest},${issued.stored.policy},${key.version},
          ${input.host},${host.routing_version},${actor.credential_epoch},${actor.authorization_epoch},${now},${now},
          ${idleExpiresAt},${absoluteExpiresAt},'ACTIVE')`;
        const previous = await tx`select sequence::text,event_digest from platform.security_event
          where tenant_id=${input.tenantId} order by sequence desc limit 1`;
        const sequence = (BigInt(previous[0]?.sequence ?? "0") + 1n).toString();
        const previousDigest = previous[0]?.event_digest ?? "0".repeat(64);
        // Explicit ordered, non-secret event fields. No provider assertion/identifier metadata.
        const canonicalEvent = JSON.stringify({
          actorId: String(actor.id),
          environment: key.environment,
          eventId,
          flowId: String(flow.id),
          host: input.host,
          occurredAt: now.toISOString(),
          policyVersion,
          previousDigest,
          sequence,
          sessionId,
          tenantId: input.tenantId,
          type: "SESSION_ISSUED"
        });
        const eventDigest = createHash("sha3-256")
          .update(frameDigestPayload("audit-event", Buffer.from(canonicalEvent)))
          .digest("hex");
        await tx`insert into platform.security_event(id,tenant_id,actor_id,flow_id,session_id,event_type,environment,
          issued_host,policy_version,sequence,previous_digest,event_digest,occurred_at)
          values (${eventId},${input.tenantId},${actor.id},${flow.id},${sessionId},'SESSION_ISSUED',${key.environment},
          ${input.host},${policyVersion},${sequence},${previousDigest},${eventDigest},${now})`;
        await tx`insert into nox_foundation.outbox(event_id,tenant_id,source,source_ref,source_version,payload_version,payload,occurred_at)
          values (${eventId},${input.tenantId},'G2_SECURITY',${flow.id},1,1,
            ${tx.json({ eventId, type: "SESSION_ISSUED" })},${now})`;
        await tx`update platform.auth_flow set state='SESSION_ISSUED',issued_session_id=${sessionId},
          terminal_at=${now},entity_version=entity_version+1 where id=${flow.id}`;
        return {
          kind: "ISSUED" as const,
          sessionId,
          secret: issued.secret,
          absoluteExpiresAt,
          idleExpiresAt
        };
      });
    }
  };
}

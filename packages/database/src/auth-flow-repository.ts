import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { resolveLoginPolicy, type PasswordVerification } from "@nox-os/auth/server-session";

type FlowScope = {
  tenantId: string;
  host: string;
  environment: "staging" | "production";
  flowSecretDigest: string;
};
type StartFlow = FlowScope & {
  existingFlowSecretDigest?: string;
  routingVersion: number;
  clientNonceDigest: string;
  identifierDigest: string;
  requestDigest: string;
  keyVersion: string;
  requiredAssurance: "A1" | "A2" | "PHISHING_RESISTANT";
  policyVersion: string;
  safeReturnPath: string;
};
const digest = /^[a-f0-9]{64}$/;
async function scope(tx: TransactionSql, input: FlowScope) {
  if (
    !digest.test(input.flowSecretDigest) ||
    !["staging", "production"].includes(input.environment)
  )
    throw Error("INVALID_AUTH_FLOW_CONTEXT");
  await tx`select set_config('nox.request_host',${input.host},true),
    set_config('nox.tenant_id',${input.tenantId},true),
    set_config('nox.environment',${input.environment},true),
    set_config('nox.auth_flow_digest',${input.flowSecretDigest},true),
    set_config('nox.auth_start_nonce_digest','',true),set_config('nox.auth_start_request_digest','',true)`;
}
/** G2-owned persistence. Inputs are server-resolved facts, never HTTP DTOs.
 * Claim commits before any provider request; unknown outcomes are never re-claimed.
 */
export function createAuthFlowRepository(sql: Sql) {
  return {
    /** Exact host entry precedes credential parsing. This snapshot is only for
     * starting a flow; the issuer independently rechecks policy/routing at commit.
     * No default tenant, account lookup or legacy membership inference.
     */
    async readEntry(host: string, environment: "staging" | "production") {
      if (
        !["staging", "production"].includes(environment) ||
        host.length > 253 ||
        !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)
      )
        throw Error("AUTH_ENTRY_UNAVAILABLE");
      return sql.begin(async (tx) => {
        await tx`select set_config('nox.request_host',${host},true),set_config('nox.environment',${environment},true),
          set_config('nox.tenant_id','',true),set_config('nox.actor_id','',true),set_config('nox.auth_flow_digest','',true)`;
        const hosts =
          await tx`select h.tenant_id,h.routing_version from platform.tenant_host_registry h
          join platform.tenants t on t.id=h.tenant_id where h.host_ascii=${host}
          and h.state='ACTIVE' and h.route_kind='TENANT_CANONICAL' and t.status='ACTIVE'`;
        if (!hosts.length) return null;
        if (hosts.length !== 1) throw Error("AUTH_ENTRY_UNAVAILABLE");
        const tenantId = String(hosts[0]!.tenant_id);
        await tx`select set_config('nox.tenant_id',${tenantId},true)`;
        const policies =
          await tx`select *,clock_timestamp() as current_time from platform.security_policy_version
          where status='ACTIVE_VERSION' and (scope='PLATFORM_FLOOR' or tenant_id=${tenantId}) order by scope,id`;
        const floor = policies.find((p) => p.scope === "PLATFORM_FLOOR");
        const tightening = policies.find((p) => p.scope === "TENANT_TIGHTENING");
        if (!floor || policies.length > 2 || policies.some((p) => p.effective_at > p.current_time))
          throw Error("AUTH_POLICY_UNAVAILABLE");
        const resolved = resolveLoginPolicy(floor, tightening);
        return Object.freeze({
          tenantId,
          routingVersion: Number(hosts[0]!.routing_version),
          policyVersion: `${floor.id}:${floor.version}${tightening ? `|${tightening.id}:${tightening.version}` : ""}`,
          requiredAssurance: (["A1", "A2", "PHISHING_RESISTANT"] as const)[
            resolved.requiredRank - 1
          ]!,
          ratePolicyRef: String((tightening ?? floor).rate_policy_ref),
          detectionPolicyRef: String((tightening ?? floor).detection_policy_ref)
        });
      });
    },
    async start(input: StartFlow) {
      if (
        (input.existingFlowSecretDigest !== undefined &&
          !digest.test(input.existingFlowSecretDigest)) ||
        ![input.clientNonceDigest, input.identifierDigest, input.requestDigest].every((x) =>
          digest.test(x)
        )
      )
        throw Error("INVALID_AUTH_FLOW_DIGEST");
      return sql.begin(async (tx) => {
        await scope(tx, input);
        await tx`select set_config('nox.auth_start_nonce_digest',${input.clientNonceDigest},true),
          set_config('nox.auth_start_request_digest',${input.requestDigest},true)`;
        const host = await tx`select h.routing_version from platform.tenant_host_registry h
          join platform.tenants t on t.id=h.tenant_id
          where h.host_ascii=${input.host} and h.tenant_id=${input.tenantId} and h.state='ACTIVE'
          and h.route_kind='TENANT_CANONICAL' and t.status='ACTIVE'`;
        if (host.length !== 1 || host[0]!.routing_version !== input.routingVersion)
          throw Error("AUTH_FLOW_UNAVAILABLE");
        const inserted =
          await tx`insert into platform.auth_flow(id,tenant_id,realm,environment,issued_host,routing_version,purpose,
          client_flow_nonce_digest,flow_secret_digest,identifier_correlation_digest,request_digest,digest_policy,
          token_digest_key_version,state,required_assurance,policy_version,safe_return_path,created_at,expires_at)
          values (${randomUUID()},${input.tenantId},'TENANT',${input.environment},${input.host},${input.routingVersion},'TENANT_LOGIN',
          ${input.clientNonceDigest},${input.flowSecretDigest},${input.identifierDigest},${input.requestDigest},
          'FIPS202-SHA3-256-DOMAIN-SEPARATED-V1',${input.keyVersion},'INITIATED',${input.requiredAssurance},
          ${input.policyVersion},${input.safeReturnPath},statement_timestamp(),statement_timestamp()+interval '900 seconds')
          on conflict (realm,issued_host,client_flow_nonce_digest,purpose) do nothing returning id`;
        const rows =
          await tx`select id,state,request_digest,routing_version,expires_at,policy_version,
          identifier_correlation_digest,required_assurance,safe_return_path,token_digest_key_version,
          (flow_secret_digest=${input.flowSecretDigest} or flow_secret_digest=${input.existingFlowSecretDigest ?? ""}) as proof_matches
          from platform.auth_flow where realm='TENANT' and issued_host=${input.host}
          and client_flow_nonce_digest=${input.clientNonceDigest} and purpose='TENANT_LOGIN'`;
        if (rows.length !== 1)
          throw Error(inserted.length ? "AUTH_FLOW_UNAVAILABLE" : "AUTH_FLOW_REPLAY_CONFLICT");
        const row = rows[0]!;
        if (
          row.request_digest !== input.requestDigest ||
          row.routing_version !== input.routingVersion ||
          row.policy_version !== input.policyVersion ||
          row.identifier_correlation_digest !== input.identifierDigest ||
          row.required_assurance !== input.requiredAssurance ||
          row.safe_return_path !== input.safeReturnPath ||
          row.token_digest_key_version !== input.keyVersion
        )
          throw Error("AUTH_FLOW_REPLAY_CONFLICT");
        return {
          id: String(row.id),
          state: String(row.state),
          expiresAt: row.expires_at as Date,
          created: inserted.length === 1,
          proofMatches: row.proof_matches === true
        };
      });
    },
    async readCurrent(input: FlowScope & { flowId: string }) {
      return sql.begin(async (tx) => {
        await scope(tx, input);
        const rows = await tx`select id,state,routing_version,identifier_correlation_digest,
          policy_version,token_digest_key_version,expires_at,provider_operation_id,
          complete_operation_digest,complete_request_digest from platform.auth_flow
          where id=${input.flowId} and expires_at>clock_timestamp()`;
        return rows.length === 1 ? rows[0]! : null;
      });
    },
    async claimProvider(
      input: FlowScope & {
        flowId: string;
        identifierDigest: string;
        operationDigest: string;
        completionDigest: string;
      }
    ) {
      if (
        ![input.identifierDigest, input.operationDigest, input.completionDigest].every((x) =>
          digest.test(x)
        )
      )
        throw Error("INVALID_AUTH_COMPLETION_DIGEST");
      return sql.begin(async (tx) => {
        await scope(tx, input);
        const current = await tx`select state,identifier_correlation_digest,provider_operation_id,
          complete_operation_digest,complete_request_digest from platform.auth_flow
          where id=${input.flowId} and expires_at>clock_timestamp() for update`;
        if (current.length !== 1) return null;
        const flow = current[0]!;
        if (flow.identifier_correlation_digest !== input.identifierDigest)
          throw Error("AUTH_COMPLETION_IDENTITY_MISMATCH");
        if (flow.provider_operation_id !== null) {
          if (
            flow.complete_operation_digest !== input.operationDigest ||
            flow.complete_request_digest !== input.completionDigest
          )
            throw Error("AUTH_COMPLETION_REPLAY_CONFLICT");
          return null;
        }
        if (flow.state !== "INITIATED") return null;
        const operationId = randomUUID();
        const rows = await tx`update platform.auth_flow set state='PENDING_RECONCILIATION',
          provider_operation_id=${operationId},complete_operation_digest=${input.operationDigest},
          complete_request_digest=${input.completionDigest},entity_version=entity_version+1
          where id=${input.flowId} and state='INITIATED' and expires_at>clock_timestamp()
          returning id`;
        return rows.length === 1 ? { operationId } : null;
      });
    },
    async recordProvider(
      input: FlowScope & { flowId: string; operationId: string; result: PasswordVerification }
    ) {
      if (input.result.kind === "PENDING_RECONCILIATION") return false;
      return sql.begin(async (tx) => {
        await scope(tx, input);
        const result = input.result;
        if (result.kind === "VERIFIED") {
          const project =
            input.environment === "staging" ? "uyfddpmbszjkhdkqvncz" : "soioshmcdwxhlgrjzkoc";
          if (
            result.environment !== input.environment ||
            result.providerKey !== "supabase" ||
            result.issuer !== `https://${project}.supabase.co/auth/v1`
          )
            throw Error("AUTH_PROVIDER_ENVIRONMENT_MISMATCH");
          const rows =
            await tx`update platform.auth_flow set state='PRIMARY_VERIFIED',verified_issuer=${result.issuer},
            verified_subject_ref=${result.subject},provider_session_ref=${result.providerSessionId},
            achieved_assurance=${result.assurance},entity_version=entity_version+1
            where id=${input.flowId} and provider_operation_id=${input.operationId}
            and state='PENDING_RECONCILIATION' and expires_at>clock_timestamp() returning id`;
          return rows.length === 1;
        }
        const rows =
          await tx`update platform.auth_flow set state='FAILED_GENERIC',terminal_at=clock_timestamp(),
          entity_version=entity_version+1 where id=${input.flowId} and provider_operation_id=${input.operationId}
          and state='PENDING_RECONCILIATION' returning id`;
        return rows.length === 1;
      });
    }
  };
}

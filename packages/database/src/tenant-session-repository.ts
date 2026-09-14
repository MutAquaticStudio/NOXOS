import type { Sql } from "postgres";
import type { TenantSessionRepository, CurrentSessionRecord } from "@nox-os/auth/server-session";

/** Read only; no provisioning, role inference, JWT fallback or session issuance.
 * Lookup context consists only of a server-generated keyed digest and trusted host.
 * All connection context is transaction-local, including on pooled connections.
 */
export function createTenantSessionRepository(sql: Sql): TenantSessionRepository {
  return {
    async readCurrent({ host, digests }) {
      if (digests.length === 0 || digests.length > 8 || !host || host.length > 253) return [];
      return sql.begin("isolation level repeatable read read only", async (tx) => {
        const result: CurrentSessionRecord[] = [];
        for (const digest of digests) {
          if (
            digest.policy !== "HMAC-SHA3-256-KEYED-V1" ||
            !["staging", "production"].includes(digest.environment) ||
            !/^[a-f0-9]{64}$/.test(digest.digest)
          )
            throw Error("INVALID_SESSION_LOOKUP");
          await tx`select set_config('nox.request_host',${host},true),
            set_config('nox.environment',${digest.environment},true),
            set_config('nox.session_digest',${digest.digest},true)`;
          const found = await tx`select id,actor_id,tenant_id from platform.application_session
            where secret_digest=${digest.digest} and token_digest_key_version=${digest.keyVersion}
            and environment=${digest.environment} and issued_host=${host}`;
          if (found.length === 0) continue;
          if (found.length !== 1) throw Error("AMBIGUOUS_SESSION_LOOKUP");
          const session = found[0]!;
          await tx`select set_config('nox.actor_id',${session.actor_id},true),
            set_config('nox.tenant_id',${session.tenant_id},true)`;
          const rows = await tx`select s.*,u.state as actor_state,
              u.credential_epoch::text as current_credential_epoch,
              u.authorization_epoch::text as current_authorization_epoch,
              t.status as tenant_state,b.state as binding_state,h.state as route_state,
              h.routing_version as current_routing_version
            from platform.application_session s
            join platform.tenant_users u on (u.id,u.tenant_id)=(s.actor_id,s.tenant_id)
            join platform.auth_principal_binding b on (b.id,b.tenant_id,b.actor_id)=(s.binding_id,s.tenant_id,s.actor_id)
            join platform.tenants t on t.id=s.tenant_id
            join platform.tenant_host_registry h on (h.host_ascii,h.tenant_id)=(s.issued_host,s.tenant_id)
            where s.id=${session.id} and s.tenant_id=${session.tenant_id} and s.issued_host=${host}`;
          if (rows.length !== 1) throw Error("SESSION_AUTHORITY_UNAVAILABLE");
          const r = rows[0]!;
          const instant = (value: unknown) => {
            if (!(value instanceof Date)) throw Error("INVALID_SESSION_TIMESTAMP");
            return value.toISOString();
          };
          result.push({
            secret: { ...digest },
            session: {
              id: r.id,
              actorKind: r.actor_kind,
              actorId: r.actor_id,
              tenantId: r.tenant_id,
              issuedHost: r.issued_host,
              routingVersionAtIssue: r.routing_version_at_issue,
              realm: r.realm,
              mode: r.mode,
              assurance: r.assurance,
              state: r.state,
              credentialEpoch: String(r.credential_epoch),
              authorizationEpoch: String(r.authorization_epoch),
              entityVersion: Number(r.entity_version),
              issuedAt: instant(r.issued_at),
              lastAuthoritativeActivityAt: instant(r.last_authoritative_activity_at),
              idleExpiresAt: instant(r.idle_expires_at),
              absoluteExpiresAt: instant(r.absolute_expires_at)
            },
            authority: {
              actorId: r.actor_id,
              tenantId: r.tenant_id,
              host: r.issued_host,
              routingVersion: r.current_routing_version,
              actorState: r.actor_state,
              tenantState: r.tenant_state,
              bindingState: r.binding_state,
              routeState: r.route_state,
              credentialEpoch: r.current_credential_epoch,
              authorizationEpoch: r.current_authorization_epoch
            }
          });
        }
        return result;
      });
    }
  };
}

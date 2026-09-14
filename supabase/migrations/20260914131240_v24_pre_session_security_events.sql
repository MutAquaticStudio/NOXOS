-- Extend the existing append-only event authority; never fabricate an actor
-- before a verified binding or invent a session for an unsuccessful login.
alter table platform.security_event alter column actor_id drop not null;
alter table platform.security_event alter column session_id drop not null;
alter table platform.security_event drop constraint security_event_event_type_check;
alter table platform.security_event add constraint security_event_event_type_check check (
  (event_type='SESSION_ISSUED' and actor_id is not null and session_id is not null)
  or (event_type in ('AUTH_PRIMARY_VERIFIED','AUTH_THROTTLED','AUTH_DENIED','AUTH_PENDING_RECONCILIATION')
    and actor_id is null and session_id is null));
alter table platform.security_event add column digest_policy text not null
  default 'FIPS202-SHA3-256-DOMAIN-SEPARATED-V1'
  check(digest_policy='FIPS202-SHA3-256-DOMAIN-SEPARATED-V1');
alter table platform.security_event add column canonicalization_policy text not null
  default 'NOXOS.AUTH-CANONICAL-JSON.1' check(canonicalization_policy='NOXOS.AUTH-CANONICAL-JSON.1');
alter table platform.security_event add constraint security_event_flow_identity unique(id,tenant_id,flow_id);
alter table nox_foundation.outbox add constraint outbox_security_event_identity
  foreign key(event_id,tenant_id,source_ref) references platform.security_event(id,tenant_id,flow_id);
alter table nox_foundation.outbox drop constraint outbox_check;
alter table nox_foundation.outbox add constraint outbox_check check (
  source='G2_SECURITY' and payload_version=1
  and payload->>'type' is not null
  and payload->>'type' in ('SESSION_ISSUED','AUTH_PRIMARY_VERIFIED','AUTH_THROTTLED','AUTH_DENIED','AUTH_PENDING_RECONCILIATION')
  and payload=jsonb_build_object('eventId',event_id::text,'type',payload->>'type'));

-- Replace, rather than OR another broad permissive INSERT policy into authority.
alter policy security_event_tenant on platform.security_event to nox_app_runtime
  using (tenant_id::text=current_setting('nox.tenant_id',true))
  with check (tenant_id::text=current_setting('nox.tenant_id',true)
    and environment=current_setting('nox.environment',true)
    and issued_host=current_setting('nox.request_host',true)
    and exists(select 1 from platform.auth_flow f where f.id=flow_id
      and f.tenant_id=security_event.tenant_id and f.issued_host=security_event.issued_host
      and f.environment=security_event.environment and f.policy_version=security_event.policy_version
      and (
        (event_type='SESSION_ISSUED' and actor_id::text=current_setting('nox.actor_id',true)
          and f.state='AUTHENTICATED')
        or (actor_id is null and session_id is null and (
          (event_type='AUTH_PRIMARY_VERIFIED' and f.state in ('PRIMARY_VERIFIED','AUTHENTICATED','SESSION_ISSUED'))
          or (event_type='AUTH_PENDING_RECONCILIATION' and f.provider_operation_id is not null)
          or (event_type='AUTH_DENIED' and f.state='FAILED_GENERIC')
          or event_type='AUTH_THROTTLED')))));
alter policy outbox_tenant on nox_foundation.outbox to nox_app_runtime
  using (tenant_id::text=current_setting('nox.tenant_id',true))
  with check (tenant_id::text=current_setting('nox.tenant_id',true)
    and exists(select 1 from platform.security_event e where e.id=event_id
      and e.tenant_id=outbox.tenant_id and e.flow_id=source_ref and e.event_type=payload->>'type'));
-- Existing FORCE RLS, column grants and immutable-event trigger remain in force.
-- No UPDATE/DELETE grant, browser grant, business data rewrite or second store.

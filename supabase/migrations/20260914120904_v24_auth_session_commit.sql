-- Versioned security policy, append-only safe events and transactional outbox.
-- Reuse the existing guard authority to serialize changes to the entire active
-- policy set (including insertion of the first tenant tightening).
insert into nox_foundation.guard_fence(scope,tenant_id,owner_gate,object_type,object_id)
  values ('PLATFORM',null,'G2','security_policy','active-set');
create policy auth_policy_guard_read on nox_foundation.guard_fence for select to nox_app_runtime
  using (scope='PLATFORM' and tenant_id is null and owner_gate='G2' and object_type='security_policy' and object_id='active-set');
create policy auth_policy_guard_lock on nox_foundation.guard_fence for update to nox_app_runtime
  using (scope='PLATFORM' and tenant_id is null and owner_gate='G2' and object_type='security_policy' and object_id='active-set')
  with check (scope='PLATFORM' and tenant_id is null and owner_gate='G2' and object_type='security_policy' and object_id='active-set');
create table platform.security_policy_version (
  id uuid primary key,
  scope text not null check (scope in ('PLATFORM_FLOOR','TENANT_TIGHTENING')),
  tenant_id uuid references platform.tenants(id),
  version bigint not null check (version>0),
  status text not null check (status in ('DRAFT','VALIDATED','ACTIVE_VERSION','RETIRED')),
  required_assurance_by_action jsonb not null check (jsonb_typeof(required_assurance_by_action)='object'),
  idle_seconds integer not null check (idle_seconds between 1 and 1800),
  absolute_seconds integer not null check (absolute_seconds between idle_seconds and 43200),
  step_up_seconds integer not null check (step_up_seconds between 1 and 300),
  recovery_token_seconds integer not null check (recovery_token_seconds between 1 and 900),
  privileged_max_seconds integer not null check (privileged_max_seconds between 1 and 1800),
  allowed_authenticator_classes jsonb not null check (jsonb_typeof(allowed_authenticator_classes)='array'),
  rate_policy_ref text not null,
  detection_policy_ref text not null,
  policy_hash text not null check (policy_hash ~ '^[a-f0-9]{64}$'),
  effective_at timestamptz not null,
  created_by text not null,
  check ((scope='PLATFORM_FLOOR')=(tenant_id is null))
);
create unique index security_policy_scope_version on platform.security_policy_version(scope,coalesce(tenant_id,'00000000-0000-0000-0000-000000000000'),version);
create unique index security_policy_one_active on platform.security_policy_version(scope,coalesce(tenant_id,'00000000-0000-0000-0000-000000000000')) where status='ACTIVE_VERSION';
create function platform.lock_security_policy_set() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform 1 from nox_foundation.guard_fence where scope='PLATFORM' and tenant_id is null
    and owner_gate='G2' and object_type='security_policy' and object_id='active-set' for update;
  if not found then raise exception 'UNKNOWN_REQUIRED_GUARD' using errcode='23514'; end if;
  return null;
end $$;
revoke all on function platform.lock_security_policy_set() from public,anon,authenticated;
create trigger security_policy_set_fence before insert or update or delete on platform.security_policy_version
  for each statement execute function platform.lock_security_policy_set();
create function platform.preserve_security_policy() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status')
    or not ((old.status='DRAFT' and new.status='VALIDATED') or (old.status='VALIDATED' and new.status='ACTIVE_VERSION')
      or (old.status='ACTIVE_VERSION' and new.status='RETIRED')) then
    raise exception 'SECURITY_POLICY_IMMUTABLE' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function platform.preserve_security_policy() from public,anon,authenticated;
create trigger security_policy_immutable before update on platform.security_policy_version for each row execute function platform.preserve_security_policy();

create table platform.security_event (
  id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  actor_id uuid not null,
  flow_id uuid not null references platform.auth_flow(id),
  session_id uuid not null,
  event_type text not null check (event_type='SESSION_ISSUED'),
  environment text not null check (environment in ('staging','production')),
  issued_host text not null,
  policy_version text not null,
  sequence bigint not null check (sequence>0),
  previous_digest text not null check (previous_digest ~ '^[a-f0-9]{64}$'),
  event_digest text not null check (event_digest ~ '^[a-f0-9]{64}$'),
  keyed_anchor_ref text,
  occurred_at timestamptz not null,
  unique(tenant_id,sequence),
  unique(flow_id,event_type),
  foreign key(actor_id,tenant_id) references platform.tenant_users(id,tenant_id),
  foreign key(session_id,tenant_id,flow_id) references platform.application_session(id,tenant_id,auth_operation_id)
);
create table nox_foundation.outbox (
  event_id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  source text not null,
  source_ref uuid not null,
  source_version bigint not null check (source_version>0),
  payload_version integer not null check (payload_version>0),
  payload jsonb not null,
  occurred_at timestamptz not null,
  publish_state text not null default 'PENDING' check (publish_state in ('PENDING','PUBLISHED')),
  -- This initial producer exposes event identity only; later owner ports can
  -- version their explicit payload contract through a migration.
  check (source='G2_SECURITY' and payload_version=1 and payload=jsonb_build_object('eventId',event_id::text,'type','SESSION_ISSUED'))
);
create function nox_foundation.reject_immutable_event_change() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'IMMUTABLE_SECURITY_EVIDENCE' using errcode='23514'; end $$;
revoke all on function nox_foundation.reject_immutable_event_change() from public,anon,authenticated;
create trigger security_event_immutable before update or delete on platform.security_event
  for each row execute function nox_foundation.reject_immutable_event_change();

alter table platform.security_policy_version enable row level security;
alter table platform.security_policy_version force row level security;
alter table platform.security_event enable row level security;
alter table platform.security_event force row level security;
alter table nox_foundation.outbox enable row level security;
alter table nox_foundation.outbox force row level security;
revoke all on platform.security_policy_version,platform.security_event,nox_foundation.outbox from public,anon,authenticated,nox_app_runtime,nox_workflow_runtime;
grant select on platform.security_policy_version to nox_app_runtime;
-- UPDATE privilege is required by PostgreSQL row locks; immutable trigger forbids modifying version.
grant update(version) on platform.security_policy_version to nox_app_runtime;
grant select,insert on platform.security_event,nox_foundation.outbox to nox_app_runtime;
create policy security_policy_read on platform.security_policy_version for select to nox_app_runtime
  using (scope='PLATFORM_FLOOR' or tenant_id::text=current_setting('nox.tenant_id',true));
create policy security_policy_lock on platform.security_policy_version for update to nox_app_runtime
  using (scope='PLATFORM_FLOOR' or tenant_id::text=current_setting('nox.tenant_id',true))
  with check (scope='PLATFORM_FLOOR' or tenant_id::text=current_setting('nox.tenant_id',true));
create policy security_event_tenant on platform.security_event to nox_app_runtime
  using (tenant_id::text=current_setting('nox.tenant_id',true))
  with check (tenant_id::text=current_setting('nox.tenant_id',true) and actor_id::text=current_setting('nox.actor_id',true));
create policy outbox_tenant on nox_foundation.outbox to nox_app_runtime
  using (tenant_id::text=current_setting('nox.tenant_id',true))
  with check (tenant_id::text=current_setting('nox.tenant_id',true));

-- Narrow pre-session lookup uses exact provider subject verified by server and tenant fixed by host.
create policy binding_flow_read on platform.auth_principal_binding for select to nox_app_runtime
  using (tenant_id::text=current_setting('nox.tenant_id',true)
    and provider_subject=current_setting('nox.verified_subject',true)
    and issuer=current_setting('nox.verified_issuer',true));
grant update(entity_version) on platform.tenant_users,platform.auth_principal_binding,platform.tenant_host_registry to nox_app_runtime;
create policy tenant_user_session_lock on platform.tenant_users for update to nox_app_runtime
  using (tenant_id::text=current_setting('nox.tenant_id',true) and id::text=current_setting('nox.actor_id',true))
  with check (tenant_id::text=current_setting('nox.tenant_id',true) and id::text=current_setting('nox.actor_id',true));
create policy binding_flow_lock on platform.auth_principal_binding for update to nox_app_runtime
  using (tenant_id::text=current_setting('nox.tenant_id',true) and provider_subject=current_setting('nox.verified_subject',true)
    and issuer=current_setting('nox.verified_issuer',true))
  with check (tenant_id::text=current_setting('nox.tenant_id',true) and provider_subject=current_setting('nox.verified_subject',true)
    and issuer=current_setting('nox.verified_issuer',true));
create policy host_exact_lock on platform.tenant_host_registry for update to nox_app_runtime
  using (host_ascii=current_setting('nox.request_host',true) and tenant_id::text=current_setting('nox.tenant_id',true))
  with check (host_ascii=current_setting('nox.request_host',true) and tenant_id::text=current_setting('nox.tenant_id',true));
-- Existing immutable-identity triggers forbid changing authority fields through these column grants.
grant insert on platform.application_session to nox_app_runtime;
create policy session_issue_from_flow on platform.application_session for insert to nox_app_runtime
  with check (tenant_id::text=current_setting('nox.tenant_id',true)
    and actor_id::text=current_setting('nox.actor_id',true)
    and issued_host=current_setting('nox.request_host',true)
    and environment=current_setting('nox.environment',true)
    and exists(select 1 from platform.auth_flow f where f.id=auth_operation_id
      and f.tenant_id=application_session.tenant_id and f.state='AUTHENTICATED'
      and f.verified_subject_ref=current_setting('nox.verified_subject',true)));

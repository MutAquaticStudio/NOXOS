-- v2.4 G2 fixed-tenant identity and opaque application-session read persistence.
-- Additive: legacy identities/memberships remain untouched, with no automatic
-- conversion or assignment. Provider auth.users remains credential authority.
create table platform.tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  state text not null check (state in ('ACTIVE','DISABLED')),
  credential_epoch bigint not null default 1 check (credential_epoch > 0),
  authorization_epoch bigint not null default 1 check (authorization_epoch > 0),
  entity_version bigint not null default 1 check (entity_version > 0),
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create table platform.auth_principal_binding (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  actor_id uuid not null,
  realm text not null check (realm = 'TENANT'),
  provider_key text not null check (length(provider_key) between 1 and 128),
  issuer text not null check (issuer ~ '^https://'),
  provider_subject text not null check (length(provider_subject) between 1 and 512),
  state text not null check (state in ('ACTIVE','REVOKED')),
  entity_version bigint not null default 1 check (entity_version > 0),
  foreign key (actor_id,tenant_id) references platform.tenant_users(id,tenant_id),
  unique (id,tenant_id,actor_id)
);
create unique index auth_principal_binding_active_identity
  on platform.auth_principal_binding(provider_key,issuer,provider_subject,realm,tenant_id)
  where state='ACTIVE';

create table platform.tenant_host_registry (
  host_ascii text primary key check (
    length(host_ascii) <= 253 and host_ascii = lower(host_ascii)
    and host_ascii ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),
  tenant_id uuid not null references platform.tenants(id),
  route_kind text not null check (route_kind in ('TENANT_CANONICAL','TENANT_ALIAS','TOMBSTONE')),
  state text not null check (state in ('OWNER_ACTIVATION_PENDING','ACTIVE','SUSPENDED','CLOSURE_PENDING','CLOSED','REDIRECT_ALIAS','RETIRED_TOMBSTONE')),
  routing_version integer not null check (routing_version > 0),
  policy_version text not null check (length(policy_version)>0),
  entity_version bigint not null default 1 check (entity_version > 0),
  unique (host_ascii,tenant_id),
  check (state <> 'ACTIVE' or route_kind='TENANT_CANONICAL')
);
create unique index tenant_host_registry_one_active
  on platform.tenant_host_registry(tenant_id) where state='ACTIVE';

create table platform.application_session (
  id uuid primary key default gen_random_uuid(),
  auth_operation_id uuid not null unique,
  binding_id uuid not null,
  actor_id uuid not null,
  tenant_id uuid not null,
  actor_kind text not null check (actor_kind='TENANT_USER'),
  realm text not null check (realm='TENANT'),
  mode text not null check (mode in ('NORMAL','ACCOUNT_ONLY')),
  assurance text not null check (assurance in ('A1','A2','PHISHING_RESISTANT')),
  environment text not null check (environment in ('staging','production')),
  secret_digest text not null unique check (secret_digest ~ '^[a-f0-9]{64}$'),
  token_digest_policy text not null check (token_digest_policy='HMAC-SHA3-256-KEYED-V1'),
  token_digest_key_version text not null check (token_digest_key_version ~ '^[A-Za-z0-9._-]{1,128}$'),
  issued_host text not null,
  routing_version_at_issue integer not null check (routing_version_at_issue > 0),
  credential_epoch bigint not null check (credential_epoch > 0),
  authorization_epoch bigint not null check (authorization_epoch > 0),
  issued_at timestamptz not null,
  last_authoritative_activity_at timestamptz not null,
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  state text not null check (state in ('ACTIVE','REVOKED','EXPIRED','ENDED')),
  entity_version bigint not null default 1 check (entity_version > 0),
  foreign key (binding_id,tenant_id,actor_id) references platform.auth_principal_binding(id,tenant_id,actor_id),
  foreign key (issued_host,tenant_id) references platform.tenant_host_registry(host_ascii,tenant_id),
  check (issued_at <= last_authoritative_activity_at and last_authoritative_activity_at < idle_expires_at and idle_expires_at <= absolute_expires_at)
);
create index application_session_actor_state on platform.application_session(tenant_id,actor_id,state);
create index application_session_expiry on platform.application_session(absolute_expires_at);

-- No runtime write grant until atomic auth-flow/audit/outbox issue is installed.
revoke all on platform.tenant_users,platform.auth_principal_binding,
  platform.tenant_host_registry,platform.application_session from public,anon,authenticated,nox_app_runtime,nox_workflow_runtime;
grant select on platform.tenant_users,platform.auth_principal_binding,
  platform.tenant_host_registry,platform.application_session to nox_app_runtime;
alter table platform.tenant_users enable row level security;
alter table platform.tenant_users force row level security;
alter table platform.auth_principal_binding enable row level security;
alter table platform.auth_principal_binding force row level security;
alter table platform.tenant_host_registry enable row level security;
alter table platform.tenant_host_registry force row level security;
alter table platform.application_session enable row level security;
alter table platform.application_session force row level security;

create policy tenant_user_session_read on platform.tenant_users for select to nox_app_runtime
  using (tenant_id::text=current_setting('nox.tenant_id',true) and id::text=current_setting('nox.actor_id',true));
create policy binding_session_read on platform.auth_principal_binding for select to nox_app_runtime
  using (tenant_id::text=current_setting('nox.tenant_id',true) and actor_id::text=current_setting('nox.actor_id',true));
create policy host_exact_read on platform.tenant_host_registry for select to nox_app_runtime
  using (host_ascii=current_setting('nox.request_host',true));
create policy session_digest_read on platform.application_session for select to nox_app_runtime
  using (secret_digest=current_setting('nox.session_digest',true)
    and environment=current_setting('nox.environment',true)
    and issued_host=current_setting('nox.request_host',true));

create function platform.preserve_fixed_session_identity() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_table_name='tenant_users' then
    if (new.id,new.tenant_id) is distinct from (old.id,old.tenant_id) then
      raise exception 'FIXED_TENANT_IDENTITY' using errcode='23514';
    end if;
  elsif tg_table_name='auth_principal_binding' then
    if (new.id,new.tenant_id,new.actor_id,new.realm,new.provider_key,new.issuer,new.provider_subject)
      is distinct from (old.id,old.tenant_id,old.actor_id,old.realm,old.provider_key,old.issuer,old.provider_subject) then
      raise exception 'FIXED_PROVIDER_BINDING' using errcode='23514';
    end if;
  elsif tg_table_name='tenant_host_registry' then
    if (new.host_ascii,new.tenant_id) is distinct from (old.host_ascii,old.tenant_id) then
      raise exception 'HOST_TENANT_IMMUTABLE' using errcode='23514';
    end if;
  elsif tg_table_name='application_session' then
    if (to_jsonb(new)-array['state','last_authoritative_activity_at','idle_expires_at','entity_version'])
      is distinct from (to_jsonb(old)-array['state','last_authoritative_activity_at','idle_expires_at','entity_version'])
      or old.state <> 'ACTIVE'
      or new.last_authoritative_activity_at < old.last_authoritative_activity_at then
      raise exception 'SESSION_IDENTITY_OR_TERMINAL_IMMUTABLE' using errcode='23514';
    end if;
  end if;
  if new.entity_version <> old.entity_version+1 then
    raise exception 'ENTITY_VERSION_STEP_REQUIRED' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function platform.preserve_fixed_session_identity() from public,anon,authenticated;
create trigger tenant_user_fixed_identity before update on platform.tenant_users
  for each row execute function platform.preserve_fixed_session_identity();
create trigger binding_fixed_identity before update on platform.auth_principal_binding
  for each row execute function platform.preserve_fixed_session_identity();
create trigger host_fixed_identity before update on platform.tenant_host_registry
  for each row execute function platform.preserve_fixed_session_identity();
create trigger session_fixed_identity before update on platform.application_session
  for each row execute function platform.preserve_fixed_session_identity();

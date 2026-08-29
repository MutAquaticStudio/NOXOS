-- Gate 2-A Platform Core. This private schema is only reachable through the
-- NØX API and the limited nox_app_runtime role; it is not a Supabase Data API
-- surface. These are the five and only five Platform Core tables for G2-A.

create schema if not exists platform authorization postgres;

revoke all on schema platform from public;
revoke all on schema platform from anon, authenticated;
grant usage on schema platform to nox_app_runtime;

create table platform.platform_users (
  id uuid primary key references auth.users(id),
  display_name text null,
  status text not null check (status in ('ACTIVE', 'DISABLED')),
  platform_role_key text null check (
    platform_role_key is null or platform_role_key = 'PLATFORM_OWNER'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (
    name = btrim(name) and char_length(name) between 1 and 120
  ),
  slug text not null unique check (
    char_length(slug) between 1 and 80
    and slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  status text not null check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.tenant_memberships (
  tenant_id uuid not null references platform.tenants(id),
  user_id uuid not null references platform.platform_users(id),
  role_key text not null check (role_key in ('TENANT_OWNER', 'TENANT_ADMIN', 'TENANT_MEMBER')),
  status text not null check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table platform.tenant_entitlements (
  tenant_id uuid not null references platform.tenants(id),
  key text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table platform.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null,
  actor_user_id uuid null,
  action text not null,
  resource_type text not null,
  resource_id text null,
  request_id text not null,
  correlation_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index platform_users_status_platform_role_key_idx
  on platform.platform_users(status, platform_role_key);
create index tenant_memberships_user_id_status_idx
  on platform.tenant_memberships(user_id, status);
create index tenant_memberships_tenant_id_status_role_key_idx
  on platform.tenant_memberships(tenant_id, status, role_key);
create index tenant_entitlements_tenant_id_idx
  on platform.tenant_entitlements(tenant_id);
create index audit_events_tenant_id_created_at_idx
  on platform.audit_events(tenant_id, created_at);
create index audit_events_request_id_idx
  on platform.audit_events(request_id);
create index audit_events_correlation_id_idx
  on platform.audit_events(correlation_id);

alter table platform.platform_users enable row level security;
alter table platform.platform_users force row level security;
alter table platform.tenants enable row level security;
alter table platform.tenants force row level security;
alter table platform.tenant_memberships enable row level security;
alter table platform.tenant_memberships force row level security;
alter table platform.tenant_entitlements enable row level security;
alter table platform.tenant_entitlements force row level security;
alter table platform.audit_events enable row level security;
alter table platform.audit_events force row level security;

create policy platform_users_runtime_access on platform.platform_users
  for all to nox_app_runtime using (true) with check (true);
create policy tenants_runtime_access on platform.tenants
  for all to nox_app_runtime using (true) with check (true);
create policy tenant_memberships_runtime_access on platform.tenant_memberships
  for all to nox_app_runtime using (true) with check (true);
create policy tenant_entitlements_runtime_access on platform.tenant_entitlements
  for all to nox_app_runtime using (true) with check (true);
create policy audit_events_runtime_read_insert on platform.audit_events
  for select to nox_app_runtime using (true);
create policy audit_events_runtime_insert on platform.audit_events
  for insert to nox_app_runtime with check (true);

revoke all on all tables in schema platform from public;
revoke all on all tables in schema platform from anon, authenticated;
grant select, insert, update on platform.platform_users to nox_app_runtime;
grant select, insert, update on platform.tenants to nox_app_runtime;
grant select, insert, update on platform.tenant_memberships to nox_app_runtime;
grant select, insert, update on platform.tenant_entitlements to nox_app_runtime;
grant select, insert on platform.audit_events to nox_app_runtime;

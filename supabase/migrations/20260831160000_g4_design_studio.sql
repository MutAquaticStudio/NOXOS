-- Gate 4 Design Studio persistence. Accord Architecture remains a typed JSON
-- document on design_briefs; executable compositions are immutable Formula
-- versions with frozen G3 Material snapshots.

begin;

create schema if not exists design_studio authorization postgres;
revoke all on schema design_studio from public;
revoke all on schema design_studio from anon, authenticated;
grant usage on schema design_studio to nox_app_runtime;

create table design_studio.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 160),
  description text null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table design_studio.design_briefs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  workflow_mode text not null check (
    workflow_mode in ('FORMULA_GENERATION', 'ACCORD_ARCHITECTURE')
  ),
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'INTENT_CONFIRMED', 'ARCHIVED')
  ),
  raw_brief text not null check (raw_brief = btrim(raw_brief) and char_length(raw_brief) > 0),
  brief_payload jsonb not null default '{}'::jsonb,
  normalized_intent jsonb null,
  accord_architecture_plan jsonb null,
  taxonomy_source text not null default 'OSMO' check (taxonomy_source = 'OSMO'),
  taxonomy_version text not null default 'osmo_v1.2' check (taxonomy_version = 'osmo_v1.2'),
  confirmed_by_user_id uuid null references platform.platform_users(id),
  confirmed_at timestamptz null,
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, project_id)
    references design_studio.projects(tenant_id, id),
  unique (tenant_id, id),
  unique (tenant_id, project_id, id),
  check (
    (status = 'DRAFT' and confirmed_by_user_id is null and confirmed_at is null)
    or (
      status in ('INTENT_CONFIRMED', 'ARCHIVED')
      and normalized_intent is not null
      and confirmed_by_user_id is not null
      and confirmed_at is not null
    )
  )
);

create table design_studio.formulas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  source_brief_id uuid not null,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 160),
  composition_kind text not null check (
    composition_kind in ('FULL_FORMULA', 'ACCORD_FORMULATION')
  ),
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, project_id)
    references design_studio.projects(tenant_id, id),
  foreign key (tenant_id, project_id, source_brief_id)
    references design_studio.design_briefs(tenant_id, project_id, id),
  unique (tenant_id, id)
);

create table design_studio.formula_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  formula_id uuid not null,
  version_number integer not null check (version_number > 0),
  parent_formula_version_id uuid null,
  generation_strategy text not null,
  engine_version text not null,
  reference_formula_mass_mg bigint not null default 1000000 check (
    reference_formula_mass_mg = 1000000
  ),
  taxonomy_source text not null default 'OSMO' check (taxonomy_source = 'OSMO'),
  taxonomy_version text not null default 'osmo_v1.2' check (taxonomy_version = 'osmo_v1.2'),
  intent_snapshot jsonb not null,
  resolved_composition jsonb not null,
  validation jsonb not null,
  scientific_context jsonb not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'FROZEN')),
  approval_state text not null default 'NOT_APPROVED' check (
    approval_state in ('NOT_APPROVED', 'APPROVED', 'SUPERSEDED')
  ),
  bundle_hash text null check (bundle_hash is null or bundle_hash ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid not null references platform.platform_users(id),
  frozen_by_user_id uuid null references platform.platform_users(id),
  frozen_at timestamptz null,
  approved_by_user_id uuid null references platform.platform_users(id),
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, formula_id)
    references design_studio.formulas(tenant_id, id),
  unique (tenant_id, id),
  unique (tenant_id, formula_id, id),
  unique (tenant_id, formula_id, version_number),
  foreign key (tenant_id, formula_id, parent_formula_version_id)
    references design_studio.formula_versions(tenant_id, formula_id, id),
  check (
    (status = 'DRAFT' and bundle_hash is null and frozen_by_user_id is null and frozen_at is null)
    or (status = 'FROZEN' and bundle_hash is not null and frozen_by_user_id is not null and frozen_at is not null)
  ),
  check (
    (approval_state = 'NOT_APPROVED' and approved_by_user_id is null and approved_at is null)
    or (
      approval_state in ('APPROVED', 'SUPERSEDED')
      and approved_by_user_id is not null
      and approved_at is not null
    )
  )
);

create table design_studio.formula_lines (
  tenant_id uuid not null,
  formula_version_id uuid not null,
  material_id uuid not null references material_intelligence.materials(id),
  line_order integer not null check (line_order > 0),
  normalized_mass_mg bigint not null check (normalized_mass_mg > 0),
  active_aromatic_mass_mg bigint not null check (active_aromatic_mass_mg >= 0),
  carrier_solvent_mass_mg bigint not null check (carrier_solvent_mass_mg >= 0),
  solvent_type text null,
  contribution_evidence jsonb not null default '[]'::jsonb,
  material_snapshot_hash text not null check (material_snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, formula_version_id, material_id),
  unique (tenant_id, formula_version_id, line_order),
  unique (tenant_id, formula_version_id, material_id, material_snapshot_hash),
  foreign key (tenant_id, formula_version_id)
    references design_studio.formula_versions(tenant_id, id) on delete cascade,
  check (active_aromatic_mass_mg + carrier_solvent_mass_mg = normalized_mass_mg)
);

create table design_studio.formula_frozen_snapshots (
  tenant_id uuid not null,
  formula_version_id uuid not null,
  material_id uuid not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  snapshot_payload jsonb not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, formula_version_id, material_id),
  foreign key (tenant_id, formula_version_id, material_id, snapshot_hash)
    references design_studio.formula_lines(
      tenant_id,
      formula_version_id,
      material_id,
      material_snapshot_hash
    )
      on delete cascade
);

create function design_studio.assert_formula_composition_mutable()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  parent_status text;
  version_id uuid;
  owner_tenant_id uuid;
begin
  if tg_op = 'DELETE' then
    version_id := old.formula_version_id;
    owner_tenant_id := old.tenant_id;
  else
    version_id := new.formula_version_id;
    owner_tenant_id := new.tenant_id;
  end if;

  select status into parent_status
  from design_studio.formula_versions
  where tenant_id = owner_tenant_id and id = version_id
  for update;

  if parent_status = 'FROZEN' then
    raise exception using errcode = '55000', message = 'FROZEN_FORMULA_VERSION_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

create function design_studio.protect_formula_version()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  total_mass bigint;
  line_count integer;
  snapshot_count integer;
begin
  if tg_op = 'DELETE' then
    if old.status = 'FROZEN' then
      raise exception using errcode = '55000', message = 'FROZEN_FORMULA_VERSION_IMMUTABLE';
    end if;
    return old;
  end if;

  if old.status = 'DRAFT' and new.status = 'FROZEN' then
    select coalesce(sum(normalized_mass_mg), 0), count(*)
      into total_mass, line_count
    from design_studio.formula_lines
    where tenant_id = new.tenant_id and formula_version_id = new.id;
    select count(*) into snapshot_count
    from design_studio.formula_frozen_snapshots
    where tenant_id = new.tenant_id and formula_version_id = new.id;
    if total_mass <> new.reference_formula_mass_mg or line_count = 0 or snapshot_count <> line_count then
      raise exception using errcode = '23514', message = 'FORMULA_TOTAL_OR_SNAPSHOT_SET_INVALID';
    end if;
  end if;

  if old.status = 'FROZEN' then
    if new.status <> 'FROZEN'
      or new.tenant_id is distinct from old.tenant_id
      or new.formula_id is distinct from old.formula_id
      or new.version_number is distinct from old.version_number
      or new.parent_formula_version_id is distinct from old.parent_formula_version_id
      or new.generation_strategy is distinct from old.generation_strategy
      or new.engine_version is distinct from old.engine_version
      or new.reference_formula_mass_mg is distinct from old.reference_formula_mass_mg
      or new.taxonomy_source is distinct from old.taxonomy_source
      or new.taxonomy_version is distinct from old.taxonomy_version
      or new.intent_snapshot is distinct from old.intent_snapshot
      or new.resolved_composition is distinct from old.resolved_composition
      or new.validation is distinct from old.validation
      or new.scientific_context is distinct from old.scientific_context
      or new.bundle_hash is distinct from old.bundle_hash
      or new.created_by_user_id is distinct from old.created_by_user_id
      or new.frozen_by_user_id is distinct from old.frozen_by_user_id
      or new.frozen_at is distinct from old.frozen_at
      or new.created_at is distinct from old.created_at
    then
      raise exception using errcode = '55000', message = 'FROZEN_FORMULA_VERSION_IMMUTABLE';
    end if;
    if old.approval_state = 'APPROVED'
      and new.approval_state not in ('APPROVED', 'SUPERSEDED')
    then
      raise exception using errcode = '55000', message = 'FORMULA_APPROVAL_STATE_INVALID';
    end if;
    if old.approval_state = 'SUPERSEDED' and new.approval_state <> 'SUPERSEDED' then
      raise exception using errcode = '55000', message = 'FORMULA_APPROVAL_STATE_INVALID';
    end if;
    if old.approval_state in ('APPROVED', 'SUPERSEDED')
      and (
        new.approved_by_user_id is distinct from old.approved_by_user_id
        or new.approved_at is distinct from old.approved_at
      )
    then
      raise exception using errcode = '55000', message = 'FORMULA_APPROVAL_EVIDENCE_IMMUTABLE';
    end if;
  end if;
  return new;
end
$function$;

create trigger formula_lines_mutability
before insert or update or delete on design_studio.formula_lines
for each row execute function design_studio.assert_formula_composition_mutable();

create trigger formula_frozen_snapshots_mutability
before insert or update or delete on design_studio.formula_frozen_snapshots
for each row execute function design_studio.assert_formula_composition_mutable();

create trigger formula_versions_immutability
before update or delete on design_studio.formula_versions
for each row execute function design_studio.protect_formula_version();

alter table design_studio.projects enable row level security;
alter table design_studio.projects force row level security;
alter table design_studio.design_briefs enable row level security;
alter table design_studio.design_briefs force row level security;
alter table design_studio.formulas enable row level security;
alter table design_studio.formulas force row level security;
alter table design_studio.formula_versions enable row level security;
alter table design_studio.formula_versions force row level security;
alter table design_studio.formula_lines enable row level security;
alter table design_studio.formula_lines force row level security;
alter table design_studio.formula_frozen_snapshots enable row level security;
alter table design_studio.formula_frozen_snapshots force row level security;

create policy projects_runtime_access on design_studio.projects
  for all to nox_app_runtime using (true) with check (true);
create policy design_briefs_runtime_access on design_studio.design_briefs
  for all to nox_app_runtime using (true) with check (true);
create policy formulas_runtime_access on design_studio.formulas
  for all to nox_app_runtime using (true) with check (true);
create policy formula_versions_runtime_access on design_studio.formula_versions
  for all to nox_app_runtime using (true) with check (true);
create policy formula_lines_runtime_access on design_studio.formula_lines
  for all to nox_app_runtime using (true) with check (true);
create policy formula_frozen_snapshots_runtime_access
  on design_studio.formula_frozen_snapshots
  for all to nox_app_runtime using (true) with check (true);

revoke all on all tables in schema design_studio from public;
revoke all on all tables in schema design_studio from anon, authenticated;
grant select, insert, update, delete on all tables in schema design_studio to nox_app_runtime;

revoke all on function design_studio.assert_formula_composition_mutable() from public;
revoke all on function design_studio.protect_formula_version() from public;

commit;

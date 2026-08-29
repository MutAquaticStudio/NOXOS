-- Gate 3-A Material Intelligence Core. The Material Intelligence schema is
-- private and reachable only through the NØX API using nox_app_runtime. It
-- deliberately contains the eight canonical G3 tables and reuses the G2
-- append-only platform.audit_events table for audit evidence.

create schema if not exists material_intelligence authorization postgres;

revoke all on schema material_intelligence from public;
revoke all on schema material_intelligence from anon, authenticated;
grant usage on schema material_intelligence to nox_app_runtime;

create table material_intelligence.chemical_entities (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null check (
    canonical_name = btrim(canonical_name) and char_length(canonical_name) between 1 and 240
  ),
  canonical_smiles text null,
  isomeric_smiles text null,
  inchikey text null,
  molecular_formula text null,
  molecular_weight numeric null check (molecular_weight is null or molecular_weight > 0),
  structure_status text not null check (structure_status in ('UNVERIFIED', 'VERIFIED')),
  structure_source_reference text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table material_intelligence.materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references platform.tenants(id),
  scope text not null check (scope in ('PLATFORM', 'TENANT')),
  visibility text not null check (visibility in ('PRIVATE', 'SHARED')),
  display_name text not null check (
    display_name = btrim(display_name) and char_length(display_name) between 1 and 240
  ),
  normalized_display_name text not null check (
    normalized_display_name = lower(btrim(normalized_display_name))
  ),
  material_type text not null check (
    material_type in ('SINGLE_MOLECULE', 'NATURAL', 'MIXTURE', 'DILUTION')
  ),
  approval_status text not null check (approval_status in ('PENDING_REVIEW', 'APPROVED')),
  note_classification text null check (note_classification in ('TOP', 'MID', 'BASE')),
  chemical_entity_id uuid null references material_intelligence.chemical_entities(id),
  contributor_user_id uuid not null references platform.platform_users(id),
  approved_by_user_id uuid null references platform.platform_users(id),
  approved_by_authority text null check (approved_by_authority in ('TENANT', 'PLATFORM')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'PLATFORM' and tenant_id is null)
    or (scope = 'TENANT' and tenant_id is not null)
  ),
  check (material_type = 'SINGLE_MOLECULE' or chemical_entity_id is null),
  check (
    (approval_status = 'PENDING_REVIEW' and approved_by_user_id is null and approved_by_authority is null)
    or (approval_status = 'APPROVED' and approved_by_user_id is not null and approved_by_authority is not null)
  ),
  check (scope = 'TENANT' or visibility = 'SHARED')
);

create table material_intelligence.material_identifiers (
  material_id uuid not null references material_intelligence.materials(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('CAS', 'FEMA', 'INCI')),
  value text not null check (value = btrim(value) and char_length(value) between 1 and 240),
  normalized_value text not null check (
    normalized_value = btrim(normalized_value) and char_length(normalized_value) between 1 and 240
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (material_id, identifier_type, normalized_value)
);

create table material_intelligence.material_properties (
  material_id uuid primary key references material_intelligence.materials(id) on delete cascade,
  appearance text null,
  assay text null,
  fcc_listed boolean null,
  specific_gravity jsonb null,
  pounds_per_gallon jsonb null,
  refractive_index jsonb null,
  boiling_point jsonb null,
  acid_value jsonb null,
  vapor_pressure jsonb null,
  flash_point jsonb null,
  logp_ow jsonb null,
  shelf_life text null,
  storage text null,
  source_reference text null,
  ifra_cat4_max_pct numeric null check (
    ifra_cat4_max_pct is null or (ifra_cat4_max_pct >= 0 and ifra_cat4_max_pct <= 100)
  ),
  ifra_amendment text null,
  ifra_source_reference text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table material_intelligence.material_odor_assignments (
  material_id uuid not null references material_intelligence.materials(id) on delete cascade,
  taxonomy_version text not null check (taxonomy_version = btrim(taxonomy_version)),
  assignment_type text not null check (
    assignment_type in ('GRAND_FAMILY', 'SUBFAMILY', 'DESCRIPTOR', 'TEXTURE', 'SENSATION')
  ),
  taxonomy_term text not null check (taxonomy_term = btrim(taxonomy_term)),
  intensity integer null check (intensity between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (material_id, taxonomy_version, assignment_type, taxonomy_term)
);

create table material_intelligence.material_concentrates (
  material_id uuid primary key references material_intelligence.materials(id) on delete cascade,
  source_material_id uuid not null references material_intelligence.materials(id),
  concentration_pct numeric not null check (concentration_pct > 0 and concentration_pct < 100),
  solvent_material_id uuid null references material_intelligence.materials(id),
  solvent_custom_name text null check (
    solvent_custom_name is null or (
      solvent_custom_name = btrim(solvent_custom_name) and char_length(solvent_custom_name) between 1 and 240
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (material_id <> source_material_id),
  check (solvent_material_id is null or solvent_material_id <> material_id),
  check (solvent_material_id is not null or solvent_custom_name is not null)
);

create table material_intelligence.material_components (
  material_id uuid not null references material_intelligence.materials(id) on delete cascade,
  component_material_id uuid not null references material_intelligence.materials(id),
  percentage numeric null check (percentage is null or (percentage >= 0 and percentage <= 100)),
  role text not null check (role in ('COMPONENT', 'TRACE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (material_id, component_material_id),
  check (material_id <> component_material_id)
);

create table material_intelligence.material_change_requests (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references material_intelligence.materials(id),
  tenant_id uuid null references platform.tenants(id),
  requested_by_user_id uuid not null references platform.platform_users(id),
  request_type text not null check (
    request_type in ('CREATE', 'IDENTITY', 'PHYSICAL', 'OLFACTIVE', 'DILUTION', 'COMPONENTS', 'GENERAL')
  ),
  proposed_patch jsonb not null,
  status text not null check (status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  reviewed_by_user_id uuid null references platform.platform_users(id),
  reviewed_by_authority text null check (reviewed_by_authority in ('TENANT', 'PLATFORM')),
  decision_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'PENDING_REVIEW' and reviewed_by_user_id is null and reviewed_by_authority is null)
    or (status in ('APPROVED', 'REJECTED') and reviewed_by_user_id is not null and reviewed_by_authority is not null)
  )
);

create index materials_tenant_scope_visibility_status_idx
  on material_intelligence.materials(tenant_id, scope, visibility, approval_status);
create index materials_normalized_display_name_idx
  on material_intelligence.materials(normalized_display_name);
create index material_identifiers_type_normalized_value_idx
  on material_intelligence.material_identifiers(identifier_type, normalized_value);
create index material_odor_assignments_material_taxonomy_idx
  on material_intelligence.material_odor_assignments(material_id, taxonomy_version, assignment_type);
create index material_change_requests_material_status_idx
  on material_intelligence.material_change_requests(material_id, status);
create index material_change_requests_tenant_status_idx
  on material_intelligence.material_change_requests(tenant_id, status);

alter table material_intelligence.chemical_entities enable row level security;
alter table material_intelligence.chemical_entities force row level security;
alter table material_intelligence.materials enable row level security;
alter table material_intelligence.materials force row level security;
alter table material_intelligence.material_identifiers enable row level security;
alter table material_intelligence.material_identifiers force row level security;
alter table material_intelligence.material_properties enable row level security;
alter table material_intelligence.material_properties force row level security;
alter table material_intelligence.material_odor_assignments enable row level security;
alter table material_intelligence.material_odor_assignments force row level security;
alter table material_intelligence.material_concentrates enable row level security;
alter table material_intelligence.material_concentrates force row level security;
alter table material_intelligence.material_components enable row level security;
alter table material_intelligence.material_components force row level security;
alter table material_intelligence.material_change_requests enable row level security;
alter table material_intelligence.material_change_requests force row level security;

create policy chemical_entities_runtime_access on material_intelligence.chemical_entities
  for all to nox_app_runtime using (true) with check (true);
create policy materials_runtime_access on material_intelligence.materials
  for all to nox_app_runtime using (true) with check (true);
create policy material_identifiers_runtime_access on material_intelligence.material_identifiers
  for all to nox_app_runtime using (true) with check (true);
create policy material_properties_runtime_access on material_intelligence.material_properties
  for all to nox_app_runtime using (true) with check (true);
create policy material_odor_assignments_runtime_access on material_intelligence.material_odor_assignments
  for all to nox_app_runtime using (true) with check (true);
create policy material_concentrates_runtime_access on material_intelligence.material_concentrates
  for all to nox_app_runtime using (true) with check (true);
create policy material_components_runtime_access on material_intelligence.material_components
  for all to nox_app_runtime using (true) with check (true);
create policy material_change_requests_runtime_access on material_intelligence.material_change_requests
  for all to nox_app_runtime using (true) with check (true);

revoke all on all tables in schema material_intelligence from public;
revoke all on all tables in schema material_intelligence from anon, authenticated;
grant select, insert, update on all tables in schema material_intelligence to nox_app_runtime;
grant delete on material_intelligence.material_identifiers,
  material_intelligence.material_odor_assignments,
  material_intelligence.material_concentrates,
  material_intelligence.material_components
  to nox_app_runtime;

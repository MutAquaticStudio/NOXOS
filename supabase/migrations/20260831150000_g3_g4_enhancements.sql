-- Gate 4 closure amendment for G3 read-model inputs and isolated scientific
-- artifacts. This migration is intentionally namespace-qualified: G3 truth
-- remains in material_intelligence and model output remains in
-- scientific_runtime.

begin;

alter table material_intelligence.material_properties
  add column if not exists odor_threshold jsonb null,
  add column if not exists ifra_restricted boolean not null default false,
  add column if not exists ifra_limits jsonb not null default '{}'::jsonb,
  add column if not exists eu_allergens jsonb not null default '[]'::jsonb;

create table material_intelligence.carrier_solvents (
  material_id uuid primary key
    references material_intelligence.materials(id) on delete restrict,
  solvent_code text not null unique check (
    solvent_code = upper(btrim(solvent_code))
    and char_length(solvent_code) between 1 and 40
  ),
  solvent_name text not null check (
    solvent_name = btrim(solvent_name)
    and char_length(solvent_name) between 1 and 160
  ),
  polarity text not null check (
    polarity = btrim(polarity)
    and char_length(polarity) between 1 and 80
  ),
  is_standard_diluent boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table material_intelligence.material_formulation_guidance (
  material_id uuid not null
    references material_intelligence.materials(id) on delete cascade,
  application_key text not null check (
    application_key = lower(btrim(application_key))
    and application_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  min_formula_pct numeric not null check (min_formula_pct >= 0),
  recommended_formula_pct numeric null,
  max_formula_pct numeric not null check (max_formula_pct <= 100),
  impact_class text not null check (
    impact_class in ('TRACE', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH')
  ),
  confidence text not null check (
    confidence in ('CURATED', 'SOURCE_DERIVED', 'ESTIMATED')
  ),
  source_reference text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (material_id, application_key),
  check (min_formula_pct <= max_formula_pct),
  check (
    recommended_formula_pct is null
    or recommended_formula_pct between min_formula_pct and max_formula_pct
  )
);

alter table material_intelligence.material_change_requests
  drop constraint if exists material_change_requests_request_type_check;
alter table material_intelligence.material_change_requests
  add constraint material_change_requests_request_type_check check (
    request_type in (
      'CREATE',
      'IDENTITY',
      'PHYSICAL',
      'OLFACTIVE',
      'DILUTION',
      'COMPONENTS',
      'FORMULATION_GUIDANCE',
      'GENERAL'
    )
  );

alter table material_intelligence.carrier_solvents enable row level security;
alter table material_intelligence.carrier_solvents force row level security;
alter table material_intelligence.material_formulation_guidance enable row level security;
alter table material_intelligence.material_formulation_guidance force row level security;

create policy carrier_solvents_runtime_access
  on material_intelligence.carrier_solvents
  for all to nox_app_runtime using (true) with check (true);
create policy material_formulation_guidance_runtime_access
  on material_intelligence.material_formulation_guidance
  for all to nox_app_runtime using (true) with check (true);

revoke all on material_intelligence.carrier_solvents from public, anon, authenticated;
revoke all on material_intelligence.material_formulation_guidance from public, anon, authenticated;
grant select, insert, update on material_intelligence.carrier_solvents to nox_app_runtime;
grant select, insert, update, delete
  on material_intelligence.material_formulation_guidance to nox_app_runtime;

create schema if not exists scientific_runtime authorization postgres;
revoke all on schema scientific_runtime from public;
revoke all on schema scientific_runtime from anon, authenticated;
grant usage on schema scientific_runtime to nox_app_runtime;

create extension if not exists vector with schema extensions;

create table scientific_runtime.scientific_artifacts (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null
    references material_intelligence.materials(id) on delete cascade,
  structure_hash text not null,
  artifact_type text not null,
  model_family text not null,
  model_version text not null,
  taxonomy_source text not null default 'OSMO' check (taxonomy_source = 'OSMO'),
  taxonomy_version text not null default 'osmo_v1.2' check (taxonomy_version = 'osmo_v1.2'),
  feature_schema_hash text not null,
  embedding extensions.vector(256) null,
  predictions jsonb not null default '{}'::jsonb,
  calibration_score numeric null check (
    calibration_score is null or calibration_score between 0 and 1
  ),
  created_at timestamptz not null default now(),
  unique (
    material_id,
    structure_hash,
    artifact_type,
    model_version,
    feature_schema_hash,
    taxonomy_version
  )
);

create index scientific_artifacts_material_id_idx
  on scientific_runtime.scientific_artifacts(material_id);

alter table scientific_runtime.scientific_artifacts enable row level security;
alter table scientific_runtime.scientific_artifacts force row level security;

create policy scientific_artifacts_runtime_read
  on scientific_runtime.scientific_artifacts
  for select to nox_app_runtime using (true);
create policy scientific_artifacts_runtime_insert
  on scientific_runtime.scientific_artifacts
  for insert to nox_app_runtime with check (true);

revoke all on scientific_runtime.scientific_artifacts from public, anon, authenticated;
grant select, insert on scientific_runtime.scientific_artifacts to nox_app_runtime;

commit;

-- Gate 6 Release Readiness. G4 remains Formula authority, G5 remains
-- approval-evidence authority, and G3 remains current Material truth.

begin;

create schema if not exists release_readiness authorization postgres;
revoke all on schema release_readiness from public;
revoke all on schema release_readiness from anon, authenticated;
grant usage on schema release_readiness to nox_app_runtime;

create table release_readiness.assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  formula_version_id uuid not null,
  formula_bundle_hash text not null check (formula_bundle_hash ~ '^[a-f0-9]{64}$'),
  policy_key text not null check (policy_key = 'g6-known-limit-v1'),
  policy_version text not null check (policy_version = '1'),
  release_profile jsonb not null check (
    jsonb_typeof(release_profile) = 'object'
    and release_profile ->> 'formulaVersionId' = formula_version_id::text
    and release_profile ->> 'policyKey' = policy_key
  ),
  evidence_snapshot jsonb not null check (
    jsonb_typeof(evidence_snapshot) = 'object'
    and evidence_snapshot ->> 'formulaVersionId' = formula_version_id::text
    and evidence_snapshot ->> 'formulaBundleHash' = formula_bundle_hash
  ),
  decision text not null check (decision in ('READY', 'REVIEW_REQUIRED', 'BLOCKED')),
  expected_check_count integer not null check (expected_check_count > 0),
  created_by_user_id uuid not null references platform.platform_users(id),
  assessed_by_user_id uuid not null references platform.platform_users(id),
  supersedes_assessment_id uuid null,
  created_at timestamptz not null default now(),
  assessed_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, formula_version_id)
    references design_studio.formula_versions(tenant_id, id),
  foreign key (tenant_id, supersedes_assessment_id)
    references release_readiness.assessments(tenant_id, id),
  check (supersedes_assessment_id is null or supersedes_assessment_id <> id)
);

create table release_readiness.checks (
  tenant_id uuid not null,
  assessment_id uuid not null,
  check_order integer not null check (check_order > 0),
  check_key text not null check (
    check_key = btrim(check_key) and char_length(check_key) between 1 and 120
  ),
  subject_type text not null check (subject_type in ('FORMULA', 'MATERIAL')),
  material_id uuid null references material_intelligence.materials(id),
  result text not null check (result in ('PASS', 'REVIEW', 'BLOCK')),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  message text not null check (
    message = btrim(message) and char_length(message) between 1 and 2000
  ),
  created_at timestamptz not null default now(),
  primary key (tenant_id, assessment_id, check_order),
  foreign key (tenant_id, assessment_id)
    references release_readiness.assessments(tenant_id, id),
  check (
    (subject_type = 'FORMULA' and material_id is null)
    or (subject_type = 'MATERIAL' and material_id is not null)
  )
);

create function release_readiness.assert_assessment_source()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  source_status text;
  source_approval text;
  source_bundle_hash text;
  source_composition_kind text;
  source_line_count integer;
  parent_formula_version_id uuid;
begin
  select version.status, version.approval_state, version.bundle_hash, formula.composition_kind,
         (select count(*) from design_studio.formula_lines as line
          where line.tenant_id = version.tenant_id and line.formula_version_id = version.id)
    into source_status, source_approval, source_bundle_hash, source_composition_kind,
         source_line_count
  from design_studio.formula_versions as version
  join design_studio.formulas as formula
    on formula.tenant_id = version.tenant_id and formula.id = version.formula_id
  where version.tenant_id = new.tenant_id and version.id = new.formula_version_id;

  if source_status is distinct from 'FROZEN'
    or source_approval is distinct from 'APPROVED'
    or source_composition_kind is distinct from 'FULL_FORMULA'
    or source_bundle_hash is distinct from new.formula_bundle_hash
    or source_line_count is null
    or source_line_count = 0
  then
    raise exception using errcode = '23514', message = 'FORMULA_NOT_RELEASE_ELIGIBLE';
  end if;

  if new.supersedes_assessment_id is not null then
    select formula_version_id into parent_formula_version_id
    from release_readiness.assessments
    where tenant_id = new.tenant_id and id = new.supersedes_assessment_id;
    if parent_formula_version_id is distinct from new.formula_version_id then
      raise exception using errcode = '23514', message = 'ASSESSMENT_LINEAGE_INVALID';
    end if;
  end if;
  return new;
end
$function$;

create function release_readiness.protect_final_assessment()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '55000', message = 'FINAL_RELEASE_ASSESSMENT_IMMUTABLE';
end
$function$;

create function release_readiness.protect_assessment_check()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  allowed_count integer;
  current_count integer;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '55000', message = 'RELEASE_ASSESSMENT_CHECK_IMMUTABLE';
  end if;
  select expected_check_count into allowed_count
  from release_readiness.assessments
  where tenant_id = new.tenant_id and id = new.assessment_id;
  select count(*) into current_count
  from release_readiness.checks
  where tenant_id = new.tenant_id and assessment_id = new.assessment_id;
  if allowed_count is null or current_count >= allowed_count then
    raise exception using errcode = '55000', message = 'RELEASE_ASSESSMENT_CHECK_SET_FINAL';
  end if;
  if new.subject_type = 'MATERIAL' and not exists (
    select 1
    from release_readiness.assessments as assessment
    join design_studio.formula_lines as line
      on line.tenant_id = assessment.tenant_id
     and line.formula_version_id = assessment.formula_version_id
     and line.material_id = new.material_id
    where assessment.tenant_id = new.tenant_id and assessment.id = new.assessment_id
  ) then
    raise exception using errcode = '23514', message = 'RELEASE_CHECK_MATERIAL_NOT_IN_FORMULA';
  end if;
  return new;
end
$function$;

create function release_readiness.assert_complete_check_set()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  actual_check_count integer;
  aggregated_decision text;
begin
  select count(*), case
    when bool_or(result = 'BLOCK') then 'BLOCKED'
    when bool_or(result = 'REVIEW') then 'REVIEW_REQUIRED'
    else 'READY'
  end into actual_check_count, aggregated_decision
  from release_readiness.checks
  where tenant_id = new.tenant_id and assessment_id = new.id;
  if actual_check_count is distinct from new.expected_check_count then
    raise exception using errcode = '23514', message = 'RELEASE_ASSESSMENT_CHECK_SET_INCOMPLETE';
  end if;
  if aggregated_decision is distinct from new.decision then
    raise exception using errcode = '23514', message = 'RELEASE_ASSESSMENT_DECISION_MISMATCH';
  end if;
  return null;
end
$function$;

create trigger assessments_source_guard
before insert on release_readiness.assessments
for each row execute function release_readiness.assert_assessment_source();

create trigger assessments_immutable
before update or delete on release_readiness.assessments
for each row execute function release_readiness.protect_final_assessment();

create trigger checks_immutable
before insert or update or delete on release_readiness.checks
for each row execute function release_readiness.protect_assessment_check();

create constraint trigger assessments_complete_check_set
after insert on release_readiness.assessments
deferrable initially deferred
for each row execute function release_readiness.assert_complete_check_set();

create index assessments_tenant_assessed_idx
  on release_readiness.assessments(tenant_id, assessed_at desc);
create index assessments_formula_idx
  on release_readiness.assessments(tenant_id, formula_version_id, assessed_at desc);
create index checks_material_idx
  on release_readiness.checks(tenant_id, material_id)
  where material_id is not null;
create unique index checks_formula_key_unique_idx
  on release_readiness.checks(tenant_id, assessment_id, check_key)
  where material_id is null;
create unique index checks_material_key_unique_idx
  on release_readiness.checks(tenant_id, assessment_id, material_id, check_key)
  where material_id is not null;

alter table release_readiness.assessments enable row level security;
alter table release_readiness.assessments force row level security;
alter table release_readiness.checks enable row level security;
alter table release_readiness.checks force row level security;

create policy assessments_runtime_select on release_readiness.assessments
  for select to nox_app_runtime using (true);
create policy assessments_runtime_insert on release_readiness.assessments
  for insert to nox_app_runtime with check (true);
create policy checks_runtime_select on release_readiness.checks
  for select to nox_app_runtime using (true);
create policy checks_runtime_insert on release_readiness.checks
  for insert to nox_app_runtime with check (true);

revoke all on all tables in schema release_readiness from public;
revoke all on all tables in schema release_readiness from anon, authenticated;
grant select, insert on release_readiness.assessments to nox_app_runtime;
grant select, insert on release_readiness.checks to nox_app_runtime;

revoke all on function release_readiness.assert_assessment_source() from public;
revoke all on function release_readiness.protect_final_assessment() from public;
revoke all on function release_readiness.protect_assessment_check() from public;
revoke all on function release_readiness.assert_complete_check_set() from public;

commit;

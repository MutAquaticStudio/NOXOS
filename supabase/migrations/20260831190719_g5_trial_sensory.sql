-- Gate 5 Trial & Sensory persistence. Formula composition remains owned by
-- Design Studio; this schema stores physical preparation and perception truth.

begin;

create schema if not exists trial_sensory authorization postgres;
revoke all on schema trial_sensory from public;
revoke all on schema trial_sensory from anon, authenticated;
grant usage on schema trial_sensory to nox_app_runtime;

create table trial_sensory.trials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  formula_version_id uuid not null,
  formula_bundle_hash text not null check (formula_bundle_hash ~ '^[a-f0-9]{64}$'),
  composition_kind text not null check (
    composition_kind in ('FULL_FORMULA', 'ACCORD_FORMULATION')
  ),
  taxonomy_source text not null check (taxonomy_source = 'OSMO'),
  taxonomy_version text not null check (taxonomy_version = 'osmo_v1.2'),
  preparation_mode text not null check (
    preparation_mode in ('CONCENTRATE', 'FINISHED_APPLICATION')
  ),
  application_key text not null check (
    application_key = btrim(application_key) and char_length(application_key) between 1 and 120
  ),
  dosage_pct numeric not null check (dosage_pct > 0 and dosage_pct <= 100),
  carrier_or_base_reference text null check (
    carrier_or_base_reference is null
    or (
      carrier_or_base_reference = btrim(carrier_or_base_reference)
      and char_length(carrier_or_base_reference) between 1 and 240
    )
  ),
  target_mass_mg bigint not null check (target_mass_mg > 0),
  scaling_policy_version text not null check (scaling_policy_version = 'g4-largest-remainder-v1'),
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'PREPARED', 'COMPLETED', 'CANCELLED')
  ),
  created_by_user_id uuid not null references platform.platform_users(id),
  prepared_by_user_id uuid null references platform.platform_users(id),
  cancelled_by_user_id uuid null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  prepared_at timestamptz null,
  cancelled_at timestamptz null,
  unique (tenant_id, id),
  unique (tenant_id, id, formula_version_id),
  foreign key (tenant_id, formula_version_id)
    references design_studio.formula_versions(tenant_id, id),
  check (
    (status = 'DRAFT' and prepared_by_user_id is null and prepared_at is null
      and cancelled_by_user_id is null and cancelled_at is null)
    or (status in ('PREPARED', 'COMPLETED') and prepared_by_user_id is not null
      and prepared_at is not null and cancelled_by_user_id is null and cancelled_at is null)
    or (status = 'CANCELLED' and cancelled_by_user_id is not null and cancelled_at is not null)
  )
);

create table trial_sensory.trial_lines (
  tenant_id uuid not null,
  trial_id uuid not null,
  formula_version_id uuid not null,
  material_id uuid not null,
  line_order integer not null check (line_order > 0),
  scaled_mass_mg bigint not null check (scaled_mass_mg >= 0),
  material_snapshot_hash text not null check (material_snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, trial_id, material_id),
  unique (tenant_id, trial_id, line_order),
  foreign key (tenant_id, trial_id, formula_version_id)
    references trial_sensory.trials(tenant_id, id, formula_version_id) on delete cascade,
  foreign key (tenant_id, formula_version_id, material_id, material_snapshot_hash)
    references design_studio.formula_lines(
      tenant_id,
      formula_version_id,
      material_id,
      material_snapshot_hash
    )
);

create table trial_sensory.sensory_evaluations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  trial_id uuid not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'FINAL')),
  evaluation_medium text not null check (
    evaluation_medium in ('BLOTTER', 'SKIN', 'PRODUCT', 'OTHER')
  ),
  sample_age_minutes integer not null check (sample_age_minutes >= 0),
  temperature_c numeric null,
  humidity_pct numeric null check (humidity_pct is null or (humidity_pct >= 0 and humidity_pct <= 100)),
  evaluation_text text not null default '' check (char_length(evaluation_text) <= 20000),
  diagnostic_note text null check (diagnostic_note is null or char_length(diagnostic_note) <= 10000),
  decision text null check (decision is null or decision in ('REVISION_REQUIRED', 'READY_FOR_APPROVAL')),
  evaluated_by_user_id uuid not null references platform.platform_users(id),
  finalized_by_user_id uuid null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz null,
  unique (tenant_id, id),
  unique (tenant_id, trial_id),
  foreign key (tenant_id, trial_id)
    references trial_sensory.trials(tenant_id, id),
  check (
    (status = 'DRAFT' and decision is null and finalized_by_user_id is null and finalized_at is null)
    or (status = 'FINAL' and decision is not null and finalized_by_user_id is not null
      and finalized_at is not null and char_length(btrim(evaluation_text)) > 0)
  )
);

create table trial_sensory.sensory_deltas (
  tenant_id uuid not null,
  evaluation_id uuid not null,
  phase text not null check (phase in ('TOP', 'MID', 'BASE', 'CROSS_PHASE')),
  assignment_type text not null check (
    assignment_type in ('GRAND_FAMILY', 'SUBFAMILY', 'DESCRIPTOR', 'TEXTURE', 'SENSATION')
  ),
  taxonomy_term text not null check (
    taxonomy_term = btrim(taxonomy_term) and char_length(taxonomy_term) between 1 and 160
  ),
  proposed_delta smallint null check (proposed_delta between -5 and 5),
  confirmed_delta smallint null check (confirmed_delta between -5 and 5),
  proposal_confidence numeric null check (
    proposal_confidence is null or (proposal_confidence >= 0 and proposal_confidence <= 1)
  ),
  interpreter_version text null check (
    interpreter_version is null
    or (interpreter_version = btrim(interpreter_version) and char_length(interpreter_version) between 1 and 120)
  ),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz null,
  primary key (tenant_id, evaluation_id, phase, assignment_type, taxonomy_term),
  foreign key (tenant_id, evaluation_id)
    references trial_sensory.sensory_evaluations(tenant_id, id) on delete cascade,
  check (
    (confirmed_delta is null and confirmed_at is null)
    or (confirmed_delta is not null and confirmed_at is not null)
  )
);

create function trial_sensory.assert_trial_formula_lineage()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  source_status text;
  source_bundle_hash text;
  source_composition_kind text;
  source_taxonomy_source text;
  source_taxonomy_version text;
begin
  select version.status, version.bundle_hash, formula.composition_kind,
         version.taxonomy_source, version.taxonomy_version
    into source_status, source_bundle_hash, source_composition_kind,
         source_taxonomy_source, source_taxonomy_version
  from design_studio.formula_versions as version
  join design_studio.formulas as formula
    on formula.tenant_id = version.tenant_id and formula.id = version.formula_id
  where version.tenant_id = new.tenant_id and version.id = new.formula_version_id;

  if source_status is distinct from 'FROZEN'
    or source_bundle_hash is distinct from new.formula_bundle_hash
    or source_composition_kind is distinct from new.composition_kind
    or source_taxonomy_source is distinct from new.taxonomy_source
    or source_taxonomy_version is distinct from new.taxonomy_version
  then
    raise exception using errcode = '23514', message = 'FORMULA_VERSION_NOT_FROZEN_OR_LINEAGE_MISMATCH';
  end if;
  return new;
end
$function$;

create function trial_sensory.protect_trial()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  total_mass bigint;
  line_count integer;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception using errcode = '55000', message = 'TRIAL_IMMUTABLE';
    end if;
    return old;
  end if;

  if old.status = 'DRAFT' and new.status = 'PREPARED' then
    select coalesce(sum(scaled_mass_mg), 0), count(*)
      into total_mass, line_count
    from trial_sensory.trial_lines
    where tenant_id = new.tenant_id and trial_id = new.id;
    if line_count = 0 or total_mass <> new.target_mass_mg then
      raise exception using errcode = '23514', message = 'TRIAL_FORMULA_TOTAL_INVALID';
    end if;
  elsif old.status = 'DRAFT' and new.status not in ('DRAFT', 'CANCELLED') then
    raise exception using errcode = '55000', message = 'TRIAL_STATUS_TRANSITION_INVALID';
  elsif old.status = 'PREPARED' and new.status not in ('PREPARED', 'COMPLETED', 'CANCELLED') then
    raise exception using errcode = '55000', message = 'TRIAL_STATUS_TRANSITION_INVALID';
  elsif old.status in ('COMPLETED', 'CANCELLED') then
    raise exception using errcode = '55000', message = 'TRIAL_IMMUTABLE';
  end if;

  if old.status <> 'DRAFT' and (
    new.tenant_id is distinct from old.tenant_id
    or new.formula_version_id is distinct from old.formula_version_id
    or new.formula_bundle_hash is distinct from old.formula_bundle_hash
    or new.composition_kind is distinct from old.composition_kind
    or new.taxonomy_source is distinct from old.taxonomy_source
    or new.taxonomy_version is distinct from old.taxonomy_version
    or new.preparation_mode is distinct from old.preparation_mode
    or new.application_key is distinct from old.application_key
    or new.dosage_pct is distinct from old.dosage_pct
    or new.carrier_or_base_reference is distinct from old.carrier_or_base_reference
    or new.target_mass_mg is distinct from old.target_mass_mg
    or new.scaling_policy_version is distinct from old.scaling_policy_version
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using errcode = '55000', message = 'PREPARED_TRIAL_CONTEXT_IMMUTABLE';
  end if;
  return new;
end
$function$;

create function trial_sensory.assert_trial_lines_mutable()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  owner_tenant_id uuid;
  owner_trial_id uuid;
  owner_status text;
begin
  owner_tenant_id := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  owner_trial_id := case when tg_op = 'DELETE' then old.trial_id else new.trial_id end;
  select status into owner_status
  from trial_sensory.trials
  where tenant_id = owner_tenant_id and id = owner_trial_id
  for update;
  if owner_status is distinct from 'DRAFT' then
    raise exception using errcode = '55000', message = 'TRIAL_LINES_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create function trial_sensory.protect_evaluation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  trial_status text;
  unconfirmed_count integer;
  nonzero_count integer;
begin
  if tg_op = 'INSERT' then
    select status into trial_status from trial_sensory.trials
      where tenant_id = new.tenant_id and id = new.trial_id for update;
    if trial_status is distinct from 'PREPARED' then
      raise exception using errcode = '55000', message = 'TRIAL_NOT_PREPARED';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'FINAL' then
      raise exception using errcode = '55000', message = 'FINAL_EVALUATION_IMMUTABLE';
    end if;
    return old;
  end if;
  if old.status = 'FINAL' then
    raise exception using errcode = '55000', message = 'FINAL_EVALUATION_IMMUTABLE';
  end if;
  if new.status = 'FINAL' then
    select status into trial_status from trial_sensory.trials
      where tenant_id = new.tenant_id and id = new.trial_id for update;
    if trial_status is distinct from 'PREPARED' then
      raise exception using errcode = '55000', message = 'TRIAL_NOT_PREPARED';
    end if;
    select count(*) into unconfirmed_count
    from trial_sensory.sensory_deltas
    where tenant_id = new.tenant_id and evaluation_id = new.id
      and confirmed_delta is null;
    if unconfirmed_count > 0 then
      raise exception using errcode = '23514', message = 'INVALID_SENSORY_DELTA';
    end if;
    if new.decision = 'REVISION_REQUIRED' then
      select count(*) into nonzero_count
      from trial_sensory.sensory_deltas
      where tenant_id = new.tenant_id and evaluation_id = new.id and confirmed_delta <> 0;
      if nonzero_count = 0 then
        raise exception using errcode = '23514', message = 'REVISION_REQUIRES_NONZERO_DELTA';
      end if;
    end if;
  end if;
  return new;
end
$function$;

create function trial_sensory.complete_trial_after_final_evaluation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if old.status = 'DRAFT' and new.status = 'FINAL' then
    update trial_sensory.trials set status = 'COMPLETED', updated_at = now()
    where tenant_id = new.tenant_id and id = new.trial_id and status = 'PREPARED';
  end if;
  return new;
end
$function$;

create function trial_sensory.assert_sensory_deltas_mutable()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  owner_tenant_id uuid;
  owner_evaluation_id uuid;
  evaluation_status text;
begin
  owner_tenant_id := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  owner_evaluation_id := case when tg_op = 'DELETE' then old.evaluation_id else new.evaluation_id end;
  select status into evaluation_status
  from trial_sensory.sensory_evaluations
  where tenant_id = owner_tenant_id and id = owner_evaluation_id
  for update;
  if evaluation_status is distinct from 'DRAFT' then
    raise exception using errcode = '55000', message = 'FINAL_EVALUATION_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create trigger trials_formula_lineage
before insert or update of formula_version_id, formula_bundle_hash, composition_kind,
  taxonomy_source, taxonomy_version on trial_sensory.trials
for each row execute function trial_sensory.assert_trial_formula_lineage();

create trigger trials_immutability
before update or delete on trial_sensory.trials
for each row execute function trial_sensory.protect_trial();

create trigger trial_lines_mutability
before insert or update or delete on trial_sensory.trial_lines
for each row execute function trial_sensory.assert_trial_lines_mutable();

create trigger sensory_evaluations_immutability
before insert or update or delete on trial_sensory.sensory_evaluations
for each row execute function trial_sensory.protect_evaluation();

create trigger sensory_evaluations_complete_trial
after update on trial_sensory.sensory_evaluations
for each row execute function trial_sensory.complete_trial_after_final_evaluation();

create trigger sensory_deltas_mutability
before insert or update or delete on trial_sensory.sensory_deltas
for each row execute function trial_sensory.assert_sensory_deltas_mutable();

create index trials_tenant_updated_idx on trial_sensory.trials(tenant_id, updated_at desc);
create index trial_lines_formula_idx
  on trial_sensory.trial_lines(tenant_id, formula_version_id);
create index sensory_evaluations_trial_idx
  on trial_sensory.sensory_evaluations(tenant_id, trial_id);

alter table trial_sensory.trials enable row level security;
alter table trial_sensory.trials force row level security;
alter table trial_sensory.trial_lines enable row level security;
alter table trial_sensory.trial_lines force row level security;
alter table trial_sensory.sensory_evaluations enable row level security;
alter table trial_sensory.sensory_evaluations force row level security;
alter table trial_sensory.sensory_deltas enable row level security;
alter table trial_sensory.sensory_deltas force row level security;

create policy trials_runtime_access on trial_sensory.trials
  for all to nox_app_runtime using (true) with check (true);
create policy trial_lines_runtime_access on trial_sensory.trial_lines
  for all to nox_app_runtime using (true) with check (true);
create policy sensory_evaluations_runtime_access on trial_sensory.sensory_evaluations
  for all to nox_app_runtime using (true) with check (true);
create policy sensory_deltas_runtime_access on trial_sensory.sensory_deltas
  for all to nox_app_runtime using (true) with check (true);

revoke all on all tables in schema trial_sensory from public;
revoke all on all tables in schema trial_sensory from anon, authenticated;
grant select, insert, update, delete on all tables in schema trial_sensory to nox_app_runtime;

revoke all on function trial_sensory.assert_trial_formula_lineage() from public;
revoke all on function trial_sensory.protect_trial() from public;
revoke all on function trial_sensory.assert_trial_lines_mutable() from public;
revoke all on function trial_sensory.protect_evaluation() from public;
revoke all on function trial_sensory.complete_trial_after_final_evaluation() from public;
revoke all on function trial_sensory.assert_sensory_deltas_mutable() from public;

commit;

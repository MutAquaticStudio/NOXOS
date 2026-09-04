begin;

create schema if not exists quality_control;
revoke all on schema quality_control from public, anon, authenticated;
grant usage on schema quality_control to nox_app_runtime;

create table quality_control.batch_specifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  specification_code text not null,
  version_number integer not null check (version_number > 0),
  formula_version_id uuid not null,
  formula_bundle_hash text not null check (formula_bundle_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'RETIRED')),
  supersedes_specification_id uuid null,
  notes text null,
  created_by_user_id uuid not null references platform.platform_users(id),
  activated_by_user_id uuid null references platform.platform_users(id),
  retired_by_user_id uuid null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz null,
  retired_at timestamptz null,
  unique (tenant_id, id),
  unique (tenant_id, specification_code, version_number),
  foreign key (tenant_id, formula_version_id)
    references design_studio.formula_versions(tenant_id, id),
  foreign key (tenant_id, supersedes_specification_id)
    references quality_control.batch_specifications(tenant_id, id),
  check (supersedes_specification_id is null or supersedes_specification_id <> id),
  check ((status = 'DRAFT' and activated_at is null and activated_by_user_id is null and retired_at is null and retired_by_user_id is null)
    or (status = 'ACTIVE' and activated_at is not null and activated_by_user_id is not null and retired_at is null and retired_by_user_id is null)
    or (status = 'RETIRED' and activated_at is not null and activated_by_user_id is not null and retired_at is not null and retired_by_user_id is not null))
);

create unique index quality_control_one_active_specification_idx
  on quality_control.batch_specifications(tenant_id, formula_version_id, formula_bundle_hash)
  where status = 'ACTIVE';
create unique index quality_control_specification_successor_idx
  on quality_control.batch_specifications(tenant_id, supersedes_specification_id)
  where supersedes_specification_id is not null;
create index quality_control_specification_status_idx
  on quality_control.batch_specifications(tenant_id, status, updated_at desc);

create table quality_control.batch_specification_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  specification_id uuid not null,
  item_order integer not null check (item_order > 0),
  check_key text not null check (check_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 1 and 200),
  check_type text not null check (check_type in ('NUMERIC_RANGE', 'BOOLEAN', 'QUALITATIVE')),
  unit_code text null,
  min_value numeric null,
  max_value numeric null,
  expected_boolean boolean null,
  acceptance_criteria_text text null,
  method_reference text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, specification_id, item_order),
  unique (tenant_id, specification_id, check_key),
  foreign key (tenant_id, specification_id)
    references quality_control.batch_specifications(tenant_id, id),
  check (
    (check_type = 'NUMERIC_RANGE' and unit_code is not null and length(btrim(unit_code)) > 0
      and (min_value is not null or max_value is not null) and expected_boolean is null)
    or (check_type = 'BOOLEAN' and unit_code is null and min_value is null and max_value is null
      and expected_boolean is not null)
    or (check_type = 'QUALITATIVE' and unit_code is null and min_value is null and max_value is null
      and expected_boolean is null and acceptance_criteria_text is not null
      and length(btrim(acceptance_criteria_text)) > 0)
  ),
  check (min_value is null or max_value is null or min_value <= max_value)
);
create index quality_control_specification_items_order_idx
  on quality_control.batch_specification_items(tenant_id, specification_id, item_order);

create table quality_control.batch_inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  inspection_number text not null,
  batch_id uuid not null,
  specification_id uuid not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'FINAL', 'CANCELLED')),
  outcome text null check (outcome is null or outcome in ('PASS', 'REVIEW_REQUIRED', 'FAIL')),
  supersedes_inspection_id uuid null,
  sample_reference text null,
  retest_reason text null,
  notes text null,
  created_by_user_id uuid not null references platform.platform_users(id),
  finalized_by_user_id uuid null references platform.platform_users(id),
  cancelled_by_user_id uuid null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz null,
  cancelled_at timestamptz null,
  unique (tenant_id, id),
  unique (tenant_id, inspection_number),
  foreign key (tenant_id, batch_id) references production.production_batches(tenant_id, id),
  foreign key (tenant_id, specification_id) references quality_control.batch_specifications(tenant_id, id),
  foreign key (tenant_id, supersedes_inspection_id) references quality_control.batch_inspections(tenant_id, id),
  check (supersedes_inspection_id is null or supersedes_inspection_id <> id),
  check ((supersedes_inspection_id is null and retest_reason is null)
    or (supersedes_inspection_id is not null and retest_reason is not null and length(btrim(retest_reason)) > 0)),
  check ((status = 'DRAFT' and outcome is null and finalized_at is null and finalized_by_user_id is null and cancelled_at is null and cancelled_by_user_id is null)
    or (status = 'FINAL' and outcome is not null and finalized_at is not null and finalized_by_user_id is not null and cancelled_at is null and cancelled_by_user_id is null)
    or (status = 'CANCELLED' and outcome is null and finalized_at is null and finalized_by_user_id is null and cancelled_at is not null and cancelled_by_user_id is not null))
);
create unique index quality_control_current_inspection_successor_idx
  on quality_control.batch_inspections(tenant_id, supersedes_inspection_id)
  where supersedes_inspection_id is not null and status <> 'CANCELLED';
create unique index quality_control_initial_inspection_idx
  on quality_control.batch_inspections(tenant_id, batch_id)
  where supersedes_inspection_id is null and status <> 'CANCELLED';
create index quality_control_batch_inspections_idx
  on quality_control.batch_inspections(tenant_id, batch_id, created_at desc);

create table quality_control.batch_inspection_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  inspection_id uuid not null,
  specification_item_id uuid not null,
  observed_numeric_value numeric null,
  observed_boolean_value boolean null,
  observed_text text null,
  judgement text not null check (judgement in ('PASS', 'REVIEW_REQUIRED', 'FAIL')),
  measured_by_user_id uuid not null references platform.platform_users(id),
  measured_at timestamptz not null default now(),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, inspection_id, specification_item_id),
  foreign key (tenant_id, inspection_id) references quality_control.batch_inspections(tenant_id, id),
  foreign key (tenant_id, specification_item_id) references quality_control.batch_specification_items(tenant_id, id),
  check (num_nonnulls(observed_numeric_value, observed_boolean_value, observed_text) = 1)
);
create index quality_control_inspection_results_idx
  on quality_control.batch_inspection_results(tenant_id, inspection_id, specification_item_id);

create table quality_control.batch_release_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  batch_id uuid not null,
  decision text not null check (decision in ('HOLD', 'RELEASED', 'REJECTED')),
  basis_inspection_id uuid null,
  release_readiness_assessment_id uuid null,
  supersedes_decision_id uuid null,
  reason text null,
  decided_by_user_id uuid not null references platform.platform_users(id),
  decided_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, batch_id) references production.production_batches(tenant_id, id),
  foreign key (tenant_id, basis_inspection_id) references quality_control.batch_inspections(tenant_id, id),
  foreign key (tenant_id, release_readiness_assessment_id)
    references release_readiness.assessments(tenant_id, id),
  foreign key (tenant_id, supersedes_decision_id) references quality_control.batch_release_decisions(tenant_id, id),
  check (supersedes_decision_id is null or supersedes_decision_id <> id),
  check (decision <> 'HOLD' or (reason is not null and length(btrim(reason)) > 0)),
  check (decision <> 'RELEASED' or (basis_inspection_id is not null and release_readiness_assessment_id is not null)),
  check (decision <> 'REJECTED' or (basis_inspection_id is not null and reason is not null and length(btrim(reason)) > 0))
);
create unique index quality_control_decision_successor_idx
  on quality_control.batch_release_decisions(tenant_id, supersedes_decision_id)
  where supersedes_decision_id is not null;
create unique index quality_control_terminal_decision_idx
  on quality_control.batch_release_decisions(tenant_id, batch_id)
  where decision in ('RELEASED', 'REJECTED');
create index quality_control_batch_decisions_idx
  on quality_control.batch_release_decisions(tenant_id, batch_id, decided_at desc);

create or replace function quality_control.enforce_specification_lifecycle()
returns trigger language plpgsql set search_path = pg_catalog, quality_control as $$
begin
  if old.status = 'DRAFT' and new.status in ('DRAFT', 'ACTIVE') then return new; end if;
  if old.status = 'ACTIVE' and new.status = 'RETIRED'
     and new.id = old.id and new.tenant_id = old.tenant_id
     and new.specification_code = old.specification_code and new.version_number = old.version_number
     and new.formula_version_id = old.formula_version_id and new.formula_bundle_hash = old.formula_bundle_hash
     and new.supersedes_specification_id is not distinct from old.supersedes_specification_id
     and new.notes is not distinct from old.notes and new.created_by_user_id = old.created_by_user_id
     and new.activated_by_user_id = old.activated_by_user_id and new.activated_at = old.activated_at
     and new.created_at = old.created_at then return new; end if;
  raise exception 'QC_SPECIFICATION_NOT_EDITABLE' using errcode = 'P0001';
end $$;
create trigger quality_control_specification_lifecycle before update on quality_control.batch_specifications
for each row execute function quality_control.enforce_specification_lifecycle();

create or replace function quality_control.enforce_specification_item_editability()
returns trigger language plpgsql set search_path = pg_catalog, quality_control as $$
declare
  spec_status text;
  row_tenant_id uuid;
  row_specification_id uuid;
begin
  if tg_op = 'DELETE' then
    row_tenant_id := old.tenant_id;
    row_specification_id := old.specification_id;
  else
    row_tenant_id := new.tenant_id;
    row_specification_id := new.specification_id;
  end if;
  select status into spec_status from quality_control.batch_specifications
  where tenant_id = row_tenant_id and id = row_specification_id;
  if spec_status <> 'DRAFT' then raise exception 'QC_SPECIFICATION_NOT_EDITABLE' using errcode = 'P0001'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger quality_control_specification_item_editability before insert or update or delete on quality_control.batch_specification_items
for each row execute function quality_control.enforce_specification_item_editability();

create or replace function quality_control.enforce_inspection_lifecycle()
returns trigger language plpgsql set search_path = pg_catalog, quality_control as $$
begin
  if old.status = 'DRAFT' and new.status in ('DRAFT', 'FINAL', 'CANCELLED') then return new; end if;
  raise exception 'QC_INSPECTION_NOT_EDITABLE' using errcode = 'P0001';
end $$;
create trigger quality_control_inspection_lifecycle before update on quality_control.batch_inspections
for each row execute function quality_control.enforce_inspection_lifecycle();

create or replace function quality_control.enforce_inspection_result_editability()
returns trigger language plpgsql set search_path = pg_catalog, quality_control as $$
declare
  inspection_status text;
  row_tenant_id uuid;
  row_inspection_id uuid;
begin
  if tg_op = 'DELETE' then
    row_tenant_id := old.tenant_id;
    row_inspection_id := old.inspection_id;
  else
    row_tenant_id := new.tenant_id;
    row_inspection_id := new.inspection_id;
  end if;
  select status into inspection_status from quality_control.batch_inspections
  where tenant_id = row_tenant_id and id = row_inspection_id;
  if inspection_status <> 'DRAFT' then raise exception 'QC_INSPECTION_NOT_EDITABLE' using errcode = 'P0001'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger quality_control_inspection_result_editability before insert or update or delete on quality_control.batch_inspection_results
for each row execute function quality_control.enforce_inspection_result_editability();

create or replace function quality_control.reject_immutable_change()
returns trigger language plpgsql as $$
begin
  raise exception 'QC_IMMUTABLE_HISTORY' using errcode = 'P0001';
end $$;
create trigger quality_control_decision_immutable before update or delete on quality_control.batch_release_decisions
for each row execute function quality_control.reject_immutable_change();
create trigger quality_control_specification_delete_forbidden before delete on quality_control.batch_specifications
for each row execute function quality_control.reject_immutable_change();
create trigger quality_control_inspection_delete_forbidden before delete on quality_control.batch_inspections
for each row execute function quality_control.reject_immutable_change();

alter table quality_control.batch_specifications enable row level security;
alter table quality_control.batch_specifications force row level security;
alter table quality_control.batch_specification_items enable row level security;
alter table quality_control.batch_specification_items force row level security;
alter table quality_control.batch_inspections enable row level security;
alter table quality_control.batch_inspections force row level security;
alter table quality_control.batch_inspection_results enable row level security;
alter table quality_control.batch_inspection_results force row level security;
alter table quality_control.batch_release_decisions enable row level security;
alter table quality_control.batch_release_decisions force row level security;

create policy quality_control_runtime_specifications on quality_control.batch_specifications for all to nox_app_runtime using (true) with check (true);
create policy quality_control_runtime_items on quality_control.batch_specification_items for all to nox_app_runtime using (true) with check (true);
create policy quality_control_runtime_inspections on quality_control.batch_inspections for all to nox_app_runtime using (true) with check (true);
create policy quality_control_runtime_results on quality_control.batch_inspection_results for all to nox_app_runtime using (true) with check (true);
create policy quality_control_runtime_decisions on quality_control.batch_release_decisions for all to nox_app_runtime using (true) with check (true);

revoke all on all tables in schema quality_control from public, anon, authenticated;
grant select, insert, update on all tables in schema quality_control to nox_app_runtime;
grant delete on quality_control.batch_specification_items, quality_control.batch_inspection_results to nox_app_runtime;

commit;

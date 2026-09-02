begin;

create schema if not exists production;
revoke all on schema production from public, anon, authenticated;
grant usage on schema production to nox_app_runtime;

create table if not exists production.production_orders (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references platform.tenants(id),
  order_number text not null, formula_version_id uuid not null, formula_bundle_hash text not null,
  target_mass_mg bigint not null check (target_mass_mg > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED','ABORTED')),
  release_readiness_assessment_id uuid null, notes text null,
  created_by_user_id uuid not null references platform.platform_users(id),
  released_by_user_id uuid null references platform.platform_users(id),
  cancelled_by_user_id uuid null references platform.platform_users(id),
  completed_by_user_id uuid null references platform.platform_users(id),
  aborted_by_user_id uuid null references platform.platform_users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  released_at timestamptz null, cancelled_at timestamptz null,
  completed_at timestamptz null, aborted_at timestamptz null,
  unique (tenant_id, id), unique (tenant_id, order_number),
  check (status in ('DRAFT','CANCELLED') or release_readiness_assessment_id is not null)
);

create table if not exists production.production_order_lines (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references platform.tenants(id),
  production_order_id uuid not null, formula_line_order integer not null check (formula_line_order > 0),
  material_id uuid not null, required_mass_mg bigint not null check (required_mass_mg > 0),
  material_snapshot_hash text not null, created_at timestamptz not null default now(),
  unique (tenant_id, id), unique (tenant_id, production_order_id, formula_line_order),
  unique (tenant_id, production_order_id, material_id),
  foreign key (tenant_id, production_order_id) references production.production_orders(tenant_id, id)
);

create table if not exists production.production_material_allocations (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references platform.tenants(id),
  production_order_id uuid not null, production_order_line_id uuid not null, material_id uuid not null,
  inventory_lot_id uuid not null, inventory_location_id uuid not null,
  allocated_mass_mg bigint not null check (allocated_mass_mg > 0),
  inventory_reservation_id uuid null, inventory_consumption_movement_id uuid null,
  reservation_operation_key text not null, consumption_operation_key text not null,
  created_by_user_id uuid not null references platform.platform_users(id), created_at timestamptz not null default now(),
  unique (tenant_id, id), unique (tenant_id, reservation_operation_key), unique (tenant_id, consumption_operation_key),
  foreign key (tenant_id, production_order_id) references production.production_orders(tenant_id, id),
  foreign key (tenant_id, production_order_line_id) references production.production_order_lines(tenant_id, id)
);

create table if not exists production.production_batches (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references platform.tenants(id),
  batch_number text not null, production_order_id uuid not null,
  formula_version_id uuid not null, formula_bundle_hash text not null,
  release_readiness_assessment_id uuid not null, start_readiness_assessment_id uuid not null,
  target_mass_mg bigint not null check (target_mass_mg > 0), actual_output_mass_mg bigint null check (actual_output_mass_mg > 0),
  process_notes text null, abort_reason text null,
  started_by_user_id uuid not null references platform.platform_users(id),
  completed_by_user_id uuid null references platform.platform_users(id),
  aborted_by_user_id uuid null references platform.platform_users(id),
  started_at timestamptz not null default now(), completed_at timestamptz null, aborted_at timestamptz null,
  unique (tenant_id, id), unique (tenant_id, batch_number), unique (tenant_id, production_order_id),
  foreign key (tenant_id, production_order_id) references production.production_orders(tenant_id, id),
  check ((actual_output_mass_mg is null and completed_at is null and completed_by_user_id is null) or (actual_output_mass_mg is not null and completed_at is not null and completed_by_user_id is not null)),
  check ((abort_reason is null and aborted_at is null and aborted_by_user_id is null) or (abort_reason is not null and aborted_at is not null and aborted_by_user_id is not null))
);

create index if not exists production_orders_status_idx on production.production_orders(tenant_id, status, updated_at desc);
create index if not exists production_order_lines_order_idx on production.production_order_lines(tenant_id, production_order_id, formula_line_order);
create index if not exists production_allocations_order_idx on production.production_material_allocations(tenant_id, production_order_id);
create index if not exists production_batches_order_idx on production.production_batches(tenant_id, production_order_id);

create or replace function production.enforce_order_transition()
returns trigger language plpgsql as $$
begin
  if (old.status, new.status) not in (
    ('DRAFT','DRAFT'), ('DRAFT','RELEASED'), ('DRAFT','CANCELLED'),
    ('RELEASED','RELEASED'), ('RELEASED','IN_PROGRESS'), ('RELEASED','CANCELLED'),
    ('IN_PROGRESS','IN_PROGRESS'), ('IN_PROGRESS','COMPLETED'), ('IN_PROGRESS','ABORTED'),
    ('COMPLETED','COMPLETED'), ('CANCELLED','CANCELLED'), ('ABORTED','ABORTED')
  ) then raise exception 'PRODUCTION_ORDER_INVALID_TRANSITION' using errcode = 'P0001';
  if old.status <> 'DRAFT' and (new.target_mass_mg <> old.target_mass_mg or new.formula_version_id <> old.formula_version_id or new.formula_bundle_hash <> old.formula_bundle_hash) then
    raise exception 'PRODUCTION_ORDER_LINEAGE_IMMUTABLE' using errcode = 'P0001';
  return new;
end $$;
drop trigger if exists production_order_transition on production.production_orders;
create trigger production_order_transition before update on production.production_orders
for each row execute function production.enforce_order_transition();

create or replace function production.enforce_terminal_order()
returns trigger language plpgsql as $$
begin
  if old.status in ('COMPLETED', 'CANCELLED', 'ABORTED')
     and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'PRODUCTION_ORDER_TERMINAL' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists production_order_terminal on production.production_orders;
create trigger production_order_terminal before update on production.production_orders
for each row execute function production.enforce_terminal_order();

create or replace function production.enforce_draft_lines()
returns trigger language plpgsql as $$
declare current_status text;
begin
  select status into current_status
  from production.production_orders
  where tenant_id = old.tenant_id
    and id = old.production_order_id;
  if current_status is null then
    raise exception 'PRODUCTION_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if current_status <> 'DRAFT' then
    raise exception 'PRODUCTION_LINES_IMMUTABLE' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
drop trigger if exists production_lines_draft_only on production.production_order_lines;
create trigger production_lines_draft_only before update or delete on production.production_order_lines
for each row execute function production.enforce_draft_lines();

create or replace function production.enforce_started_allocation_immutability()
returns trigger language plpgsql as $$
declare current_status text;
begin
  select status into current_status from production.production_orders where tenant_id = old.tenant_id and id = old.production_order_id;
  if current_status <> 'DRAFT' and (new.production_order_line_id <> old.production_order_line_id or new.material_id <> old.material_id or new.inventory_lot_id <> old.inventory_lot_id or new.inventory_location_id <> old.inventory_location_id or new.allocated_mass_mg <> old.allocated_mass_mg) then
    raise exception 'PRODUCTION_ALLOCATION_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists production_allocation_immutability on production.production_material_allocations;
create trigger production_allocation_immutability before update on production.production_material_allocations
for each row execute function production.enforce_started_allocation_immutability();

create or replace function production.enforce_draft_allocations()
returns trigger language plpgsql as $$
declare current_status text;
begin
  select status into current_status
  from production.production_orders
  where tenant_id = old.tenant_id
    and id = old.production_order_id;
  if current_status is null then
    raise exception 'PRODUCTION_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' and current_status <> 'DRAFT' then
    raise exception 'PRODUCTION_ALLOCATION_IMMUTABLE' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists production_allocations_draft_only on production.production_material_allocations;
create trigger production_allocations_draft_only before delete on production.production_material_allocations
for each row execute function production.enforce_draft_allocations();

create or replace function production.enforce_terminal_batch()
returns trigger language plpgsql as $$
begin
  if (old.completed_at is not null or old.aborted_at is not null) and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'PRODUCTION_BATCH_TERMINAL' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists production_batch_terminal on production.production_batches;
create trigger production_batch_terminal before update on production.production_batches
for each row execute function production.enforce_terminal_batch();

alter table production.production_orders enable row level security;
alter table production.production_orders force row level security;
alter table production.production_order_lines enable row level security;
alter table production.production_order_lines force row level security;
alter table production.production_material_allocations enable row level security;
alter table production.production_material_allocations force row level security;
alter table production.production_batches enable row level security;
alter table production.production_batches force row level security;
create policy production_runtime_orders on production.production_orders for all to nox_app_runtime using (true) with check (true);
create policy production_runtime_lines on production.production_order_lines for all to nox_app_runtime using (true) with check (true);
create policy production_runtime_allocations on production.production_material_allocations for all to nox_app_runtime using (true) with check (true);
create policy production_runtime_batches on production.production_batches for all to nox_app_runtime using (true) with check (true);
revoke all on all tables in schema production from public, anon, authenticated;
grant select, insert, update on all tables in schema production to nox_app_runtime;

commit;

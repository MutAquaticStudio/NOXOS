-- Gate 7 Inventory & Lot Traceability. Physical stock authority is an immutable
-- movement ledger; reservations reduce availability without changing on-hand.
-- The private schema is reachable only through the NØX API limited runtime role.

begin;

create schema if not exists inventory authorization postgres;
revoke all on schema inventory from public;
revoke all on schema inventory from anon, authenticated;
grant usage on schema inventory to nox_app_runtime;

create table inventory.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_code text not null check (
    location_code = btrim(location_code)
    and location_code ~ '^[A-Z0-9]+([-_][A-Z0-9]+)*$'
    and char_length(location_code) between 1 and 80
  ),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 160),
  description text null check (description is null or char_length(description) <= 1000),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, location_code)
);

create table inventory.material_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  material_id uuid not null references material_intelligence.materials(id),
  lot_code text not null check (
    lot_code = btrim(lot_code) and char_length(lot_code) between 1 and 120
  ),
  supplier_lot_code text null check (
    supplier_lot_code is null
    or (supplier_lot_code = btrim(supplier_lot_code) and char_length(supplier_lot_code) <= 120)
  ),
  manufactured_at timestamptz null,
  expires_at timestamptz null,
  retest_at timestamptz null,
  lifecycle_status text not null default 'OPEN' check (lifecycle_status in ('OPEN', 'CLOSED')),
  availability_status text not null default 'AVAILABLE' check (
    availability_status in ('AVAILABLE', 'HOLD')
  ),
  notes text null check (notes is null or char_length(notes) <= 4000),
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz null,
  closed_by_user_id uuid null references platform.platform_users(id),
  unique (tenant_id, id),
  unique (tenant_id, id, material_id),
  unique (tenant_id, lot_code),
  check (
    (lifecycle_status = 'OPEN' and closed_at is null and closed_by_user_id is null)
    or (lifecycle_status = 'CLOSED' and closed_at is not null and closed_by_user_id is not null)
  )
);

create table inventory.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  lot_id uuid not null,
  material_id uuid not null,
  movement_type text not null check (
    movement_type in (
      'RECEIPT', 'TRANSFER', 'CONSUMPTION', 'RETURN_IN',
      'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DISPOSAL'
    )
  ),
  quantity_mg bigint not null check (quantity_mg > 0),
  from_location_id uuid null,
  to_location_id uuid null,
  source_module text not null check (
    source_module in ('MANUAL', 'TRIAL', 'PROCUREMENT', 'PRODUCTION')
  ),
  source_reference_id text null check (
    source_reference_id is null or char_length(btrim(source_reference_id)) between 1 and 240
  ),
  reason_code text null check (
    reason_code is null or char_length(btrim(reason_code)) between 1 and 120
  ),
  operation_key text not null check (
    operation_key = btrim(operation_key) and char_length(operation_key) between 1 and 240
  ),
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, id, lot_id, material_id),
  unique (tenant_id, operation_key),
  foreign key (tenant_id, lot_id, material_id)
    references inventory.material_lots(tenant_id, id, material_id),
  foreign key (tenant_id, from_location_id)
    references inventory.locations(tenant_id, id),
  foreign key (tenant_id, to_location_id)
    references inventory.locations(tenant_id, id),
  check (
    (movement_type in ('RECEIPT', 'RETURN_IN', 'ADJUSTMENT_IN')
      and from_location_id is null and to_location_id is not null)
    or (movement_type = 'TRANSFER' and from_location_id is not null
      and to_location_id is not null and from_location_id <> to_location_id)
    or (movement_type in ('CONSUMPTION', 'ADJUSTMENT_OUT', 'DISPOSAL')
      and from_location_id is not null and to_location_id is null)
  ),
  check (
    (source_module = 'MANUAL')
    or (source_module in ('TRIAL', 'PROCUREMENT', 'PRODUCTION')
      and source_reference_id is not null)
  )
);

create table inventory.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  lot_id uuid not null,
  material_id uuid not null,
  location_id uuid not null,
  quantity_mg bigint not null check (quantity_mg > 0),
  source_module text not null check (source_module in ('MANUAL', 'TRIAL', 'PRODUCTION')),
  source_reference_id text null check (
    source_reference_id is null or char_length(btrim(source_reference_id)) between 1 and 240
  ),
  operation_key text not null check (
    operation_key = btrim(operation_key) and char_length(operation_key) between 1 and 240
  ),
  status text not null default 'ACTIVE' check (
    status in ('ACTIVE', 'RELEASED', 'CONSUMED', 'CANCELLED')
  ),
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  released_at timestamptz null,
  consumed_at timestamptz null,
  cancelled_at timestamptz null,
  consumed_movement_id uuid null,
  unique (tenant_id, id),
  unique (tenant_id, operation_key),
  foreign key (tenant_id, lot_id, material_id)
    references inventory.material_lots(tenant_id, id, material_id),
  foreign key (tenant_id, location_id)
    references inventory.locations(tenant_id, id),
  foreign key (tenant_id, consumed_movement_id, lot_id, material_id)
    references inventory.stock_movements(tenant_id, id, lot_id, material_id),
  check (
    source_module = 'MANUAL'
    or (source_module in ('TRIAL', 'PRODUCTION') and source_reference_id is not null)
  ),
  check (
    (status = 'ACTIVE' and released_at is null and consumed_at is null
      and cancelled_at is null and consumed_movement_id is null)
    or (status = 'RELEASED' and released_at is not null and consumed_at is null
      and cancelled_at is null and consumed_movement_id is null)
    or (status = 'CANCELLED' and released_at is null and consumed_at is null
      and cancelled_at is not null and consumed_movement_id is null)
    or (status = 'CONSUMED' and released_at is null and consumed_at is not null
      and cancelled_at is null and consumed_movement_id is not null)
  )
);

create function inventory.assert_material_lot_access()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  readable boolean;
begin
  select (
    material.scope = 'PLATFORM'
    or material.tenant_id = new.tenant_id
    or (material.visibility = 'SHARED' and material.approval_status = 'APPROVED')
  ) into readable
  from material_intelligence.materials as material
  where material.id = new.material_id;
  if readable is not true then
    raise exception using errcode = '23503', message = 'MATERIAL_ACCESS_DENIED';
  end if;
  return new;
end
$function$;

create function inventory.protect_location()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  reference_exists boolean;
  on_hand bigint;
  active_reserved bigint;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'LOCATION_DELETE_FORBIDDEN';
  end if;
  select exists (
    select 1 from inventory.stock_movements
    where tenant_id = old.tenant_id
      and (from_location_id = old.id or to_location_id = old.id)
    union all
    select 1 from inventory.stock_reservations
    where tenant_id = old.tenant_id and location_id = old.id
  ) into reference_exists;
  if reference_exists and new.location_code is distinct from old.location_code then
    raise exception using errcode = '55000', message = 'LOCATION_CODE_IMMUTABLE';
  end if;
  if old.status = 'ARCHIVED' and new.status <> 'ARCHIVED' then
    raise exception using errcode = '55000', message = 'LOCATION_ARCHIVED';
  end if;
  if old.status = 'ACTIVE' and new.status = 'ARCHIVED' then
    select coalesce(sum(
      case
        when movement.to_location_id = old.id then movement.quantity_mg
        when movement.from_location_id = old.id then -movement.quantity_mg
        else 0
      end
    ), 0) into on_hand
    from inventory.stock_movements as movement
    where movement.tenant_id = old.tenant_id;
    select coalesce(sum(quantity_mg), 0) into active_reserved
    from inventory.stock_reservations
    where tenant_id = old.tenant_id and location_id = old.id and status = 'ACTIVE';
    if on_hand <> 0 or active_reserved <> 0 then
      raise exception using errcode = '55000', message = 'LOCATION_NOT_EMPTY';
    end if;
  end if;
  return new;
end
$function$;

create function inventory.protect_material_lot()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  movement_exists boolean;
  on_hand bigint;
  active_reserved bigint;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'LOT_DELETE_FORBIDDEN';
  end if;
  select exists (
    select 1 from inventory.stock_movements
    where tenant_id = old.tenant_id and lot_id = old.id
  ) into movement_exists;
  if movement_exists and (
    new.tenant_id is distinct from old.tenant_id
    or new.material_id is distinct from old.material_id
    or new.lot_code is distinct from old.lot_code
    or new.supplier_lot_code is distinct from old.supplier_lot_code
    or new.manufactured_at is distinct from old.manufactured_at
    or new.expires_at is distinct from old.expires_at
    or new.retest_at is distinct from old.retest_at
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using errcode = '55000', message = 'LOT_IDENTITY_IMMUTABLE';
  end if;
  if old.lifecycle_status = 'CLOSED' and new.lifecycle_status <> 'CLOSED' then
    raise exception using errcode = '55000', message = 'LOT_CLOSED';
  end if;
  if old.lifecycle_status = 'OPEN' and new.lifecycle_status = 'CLOSED' then
    select coalesce(sum(
      case
        when movement.movement_type in ('RECEIPT', 'RETURN_IN', 'ADJUSTMENT_IN')
          then movement.quantity_mg
        when movement.movement_type in ('CONSUMPTION', 'ADJUSTMENT_OUT', 'DISPOSAL')
          then -movement.quantity_mg
        else 0
      end
    ), 0) into on_hand
    from inventory.stock_movements as movement
    where movement.tenant_id = old.tenant_id and movement.lot_id = old.id;
    select coalesce(sum(quantity_mg), 0) into active_reserved
    from inventory.stock_reservations
    where tenant_id = old.tenant_id and lot_id = old.id and status = 'ACTIVE';
    if on_hand <> 0 or active_reserved <> 0 then
      raise exception using errcode = '55000', message = 'LOT_NOT_EMPTY';
    end if;
  end if;
  return new;
end
$function$;

create function inventory.protect_stock_movement()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '55000', message = 'STOCK_MOVEMENT_APPEND_ONLY';
end
$function$;

create function inventory.protect_stock_reservation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  movement record;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'RESERVATION_DELETE_FORBIDDEN';
  end if;
  if old.status <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'RESERVATION_ALREADY_TERMINAL';
  end if;
  if new.status not in ('RELEASED', 'CANCELLED', 'CONSUMED') then
    raise exception using errcode = '55000', message = 'RESERVATION_STATE_INVALID';
  end if;
  if new.tenant_id is distinct from old.tenant_id
    or new.lot_id is distinct from old.lot_id
    or new.material_id is distinct from old.material_id
    or new.location_id is distinct from old.location_id
    or new.quantity_mg is distinct from old.quantity_mg
    or new.source_module is distinct from old.source_module
    or new.source_reference_id is distinct from old.source_reference_id
    or new.operation_key is distinct from old.operation_key
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '55000', message = 'RESERVATION_IDENTITY_IMMUTABLE';
  end if;
  if new.status = 'CONSUMED' then
    select movement_type, quantity_mg, from_location_id, to_location_id,
           source_module, source_reference_id
      into movement
    from inventory.stock_movements
    where tenant_id = new.tenant_id and id = new.consumed_movement_id
      and lot_id = new.lot_id and material_id = new.material_id;
    if movement.movement_type is distinct from 'CONSUMPTION'
      or movement.quantity_mg is distinct from new.quantity_mg
      or movement.from_location_id is distinct from new.location_id
      or movement.to_location_id is not null
      or movement.source_module is distinct from new.source_module
      or movement.source_reference_id is distinct from new.source_reference_id
    then
      raise exception using errcode = '23514', message = 'CONSUMED_MOVEMENT_INVALID';
    end if;
  end if;
  return new;
end
$function$;

create trigger material_lot_access
before insert or update of tenant_id, material_id on inventory.material_lots
for each row execute function inventory.assert_material_lot_access();
create trigger locations_protection
before update or delete on inventory.locations
for each row execute function inventory.protect_location();
create trigger material_lots_protection
before update or delete on inventory.material_lots
for each row execute function inventory.protect_material_lot();
create trigger stock_movements_append_only
before update or delete on inventory.stock_movements
for each row execute function inventory.protect_stock_movement();
create trigger stock_reservations_state_machine
before update or delete on inventory.stock_reservations
for each row execute function inventory.protect_stock_reservation();

create index material_lots_tenant_material_idx
  on inventory.material_lots(tenant_id, material_id, lifecycle_status, availability_status);
create index stock_movements_lot_created_idx
  on inventory.stock_movements(tenant_id, lot_id, created_at desc);
create index stock_movements_source_idx
  on inventory.stock_movements(tenant_id, source_module, source_reference_id);
create index stock_reservations_lot_location_status_idx
  on inventory.stock_reservations(tenant_id, lot_id, location_id, status);
create index stock_reservations_source_idx
  on inventory.stock_reservations(tenant_id, source_module, source_reference_id, status);

alter table inventory.locations enable row level security;
alter table inventory.locations force row level security;
alter table inventory.material_lots enable row level security;
alter table inventory.material_lots force row level security;
alter table inventory.stock_movements enable row level security;
alter table inventory.stock_movements force row level security;
alter table inventory.stock_reservations enable row level security;
alter table inventory.stock_reservations force row level security;

create policy locations_runtime_access on inventory.locations
  for all to nox_app_runtime using (true) with check (true);
create policy material_lots_runtime_access on inventory.material_lots
  for all to nox_app_runtime using (true) with check (true);
create policy stock_movements_runtime_read on inventory.stock_movements
  for select to nox_app_runtime using (true);
create policy stock_movements_runtime_insert on inventory.stock_movements
  for insert to nox_app_runtime with check (true);
create policy stock_reservations_runtime_access on inventory.stock_reservations
  for all to nox_app_runtime using (true) with check (true);

revoke all on all tables in schema inventory from public;
revoke all on all tables in schema inventory from anon, authenticated;
grant select, insert, update on inventory.locations to nox_app_runtime;
grant select, insert, update on inventory.material_lots to nox_app_runtime;
grant select, insert on inventory.stock_movements to nox_app_runtime;
grant select, insert, update on inventory.stock_reservations to nox_app_runtime;

revoke all on function inventory.assert_material_lot_access() from public;
revoke all on function inventory.protect_location() from public;
revoke all on function inventory.protect_material_lot() from public;
revoke all on function inventory.protect_stock_movement() from public;
revoke all on function inventory.protect_stock_reservation() from public;

commit;

-- Gate 8 Procurement & Supplier Operations. Procurement commitment is owned by
-- this private schema; physical receipt remains owned by the Gate 7 inventory
-- ledger and is written in the same PostgreSQL transaction as receipt posting.

begin;

create schema if not exists procurement authorization postgres;
revoke all on schema procurement from public;
revoke all on schema procurement from anon, authenticated;
grant usage on schema procurement to nox_app_runtime;

create table procurement.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  supplier_code text not null check (
    supplier_code = btrim(supplier_code)
    and char_length(supplier_code) between 1 and 80
    and supplier_code ~ '^[A-Z0-9]+([-_][A-Z0-9]+)*$'
  ),
  legal_name text not null check (legal_name = btrim(legal_name) and char_length(legal_name) between 1 and 200),
  display_name text not null check (display_name = btrim(display_name) and char_length(display_name) between 1 and 200),
  country_code text null check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  primary_email text null check (primary_email is null or char_length(primary_email) <= 320),
  primary_phone text null check (primary_phone is null or char_length(primary_phone) <= 80),
  website text null check (website is null or char_length(website) <= 500),
  tax_identifier text null check (tax_identifier is null or char_length(tax_identifier) <= 120),
  default_currency text null check (default_currency is null or default_currency ~ '^[A-Z]{3}$'),
  default_incoterm text null check (default_incoterm is null or char_length(default_incoterm) <= 40),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'HOLD', 'ARCHIVED')),
  notes text null check (notes is null or char_length(notes) <= 4000),
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, supplier_code)
);

create table procurement.supplier_material_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  supplier_id uuid not null,
  material_id uuid not null references material_intelligence.materials(id),
  supplier_sku text null check (supplier_sku is null or char_length(btrim(supplier_sku)) between 1 and 120),
  supplier_material_name text not null check (
    supplier_material_name = btrim(supplier_material_name)
    and char_length(supplier_material_name) between 1 and 200
  ),
  pack_size_mg bigint null check (pack_size_mg is null or pack_size_mg > 0),
  minimum_order_quantity_mg bigint null check (
    minimum_order_quantity_mg is null or minimum_order_quantity_mg > 0
  ),
  unit_price_per_kg numeric null check (unit_price_per_kg is null or unit_price_per_kg >= 0),
  currency_code text null check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  lead_time_days integer null check (lead_time_days is null or lead_time_days >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'HOLD', 'ARCHIVED')),
  last_quoted_at timestamptz null,
  source_reference text null check (source_reference is null or char_length(source_reference) <= 1000),
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, supplier_id) references procurement.suppliers(tenant_id, id)
);

create table procurement.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  po_number text not null check (po_number = btrim(po_number) and char_length(po_number) between 1 and 80),
  supplier_id uuid not null,
  order_type text not null check (order_type in ('STANDARD', 'SAMPLE')),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED')
  ),
  supplier_quote_reference text null check (
    supplier_quote_reference is null or char_length(supplier_quote_reference) <= 240
  ),
  expected_delivery_at timestamptz null,
  incoterm text null check (incoterm is null or char_length(incoterm) <= 40),
  freight_amount numeric null check (freight_amount is null or freight_amount >= 0),
  notes text null check (notes is null or char_length(notes) <= 4000),
  created_by_user_id uuid not null references platform.platform_users(id),
  approved_by_user_id uuid null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz null,
  closed_at timestamptz null,
  cancelled_at timestamptz null,
  unique (tenant_id, id),
  unique (tenant_id, po_number),
  foreign key (tenant_id, supplier_id) references procurement.suppliers(tenant_id, id),
  check (
    (status = 'DRAFT' and approved_by_user_id is null and approved_at is null and closed_at is null and cancelled_at is null)
    or (status in ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED') and approved_by_user_id is not null and approved_at is not null and closed_at is null and cancelled_at is null)
    or (status = 'CLOSED' and approved_by_user_id is not null and approved_at is not null and closed_at is not null and cancelled_at is null)
    or (status = 'CANCELLED' and closed_at is null and cancelled_at is not null)
  )
);

create table procurement.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  purchase_order_id uuid not null,
  line_order integer not null check (line_order > 0),
  material_id uuid not null references material_intelligence.materials(id),
  supplier_offer_id uuid null,
  supplier_sku_snapshot text null check (
    supplier_sku_snapshot is null or char_length(btrim(supplier_sku_snapshot)) between 1 and 120
  ),
  supplier_material_name_snapshot text not null check (
    supplier_material_name_snapshot = btrim(supplier_material_name_snapshot)
    and char_length(supplier_material_name_snapshot) between 1 and 200
  ),
  ordered_quantity_mg bigint not null check (ordered_quantity_mg > 0),
  unit_price_per_kg numeric not null check (unit_price_per_kg >= 0),
  expected_delivery_at timestamptz null,
  notes text null check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, purchase_order_id, line_order),
  foreign key (tenant_id, purchase_order_id) references procurement.purchase_orders(tenant_id, id),
  foreign key (tenant_id, supplier_offer_id) references procurement.supplier_material_offers(tenant_id, id)
);

create table procurement.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  receipt_number text not null check (
    receipt_number = btrim(receipt_number) and char_length(receipt_number) between 1 and 80
  ),
  purchase_order_id uuid not null,
  supplier_id uuid not null,
  supplier_delivery_reference text null check (
    supplier_delivery_reference is null or char_length(supplier_delivery_reference) <= 240
  ),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'POSTED', 'CANCELLED')),
  received_at timestamptz not null,
  created_by_user_id uuid not null references platform.platform_users(id),
  posted_by_user_id uuid null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  posted_at timestamptz null,
  cancelled_at timestamptz null,
  unique (tenant_id, id),
  unique (tenant_id, receipt_number),
  foreign key (tenant_id, purchase_order_id) references procurement.purchase_orders(tenant_id, id),
  foreign key (tenant_id, supplier_id) references procurement.suppliers(tenant_id, id),
  check (
    (status = 'DRAFT' and posted_by_user_id is null and posted_at is null and cancelled_at is null)
    or (status = 'POSTED' and posted_by_user_id is not null and posted_at is not null and cancelled_at is null)
    or (status = 'CANCELLED' and posted_by_user_id is null and posted_at is null and cancelled_at is not null)
  )
);

create table procurement.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  goods_receipt_id uuid not null,
  purchase_order_line_id uuid not null,
  material_id uuid not null references material_intelligence.materials(id),
  received_quantity_mg bigint not null check (received_quantity_mg > 0),
  lot_code text not null check (lot_code = btrim(lot_code) and char_length(lot_code) between 1 and 120),
  supplier_lot_code text null check (
    supplier_lot_code is null or char_length(btrim(supplier_lot_code)) between 1 and 120
  ),
  manufactured_at timestamptz null,
  expires_at timestamptz null,
  retest_at timestamptz null,
  destination_location_id uuid not null,
  inventory_lot_id uuid null,
  inventory_movement_id uuid null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, inventory_movement_id),
  foreign key (tenant_id, goods_receipt_id) references procurement.goods_receipts(tenant_id, id),
  foreign key (tenant_id, purchase_order_line_id) references procurement.purchase_order_lines(tenant_id, id),
  foreign key (tenant_id, destination_location_id) references inventory.locations(tenant_id, id),
  foreign key (tenant_id, inventory_lot_id, material_id)
    references inventory.material_lots(tenant_id, id, material_id),
  foreign key (tenant_id, inventory_movement_id, inventory_lot_id, material_id)
    references inventory.stock_movements(tenant_id, id, lot_id, material_id),
  check ((inventory_lot_id is null) = (inventory_movement_id is null))
);

create function procurement.assert_material_access()
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

create function procurement.protect_supplier()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' and exists (
    select 1 from procurement.purchase_orders
    where tenant_id = old.tenant_id and supplier_id = old.id
  ) then
    raise exception using errcode = '55000', message = 'SUPPLIER_HISTORY_IMMUTABLE';
  end if;
  if tg_op = 'UPDATE'
    and new.supplier_code is distinct from old.supplier_code
    and exists (
      select 1 from procurement.purchase_orders
      where tenant_id = old.tenant_id and supplier_id = old.id
    )
  then
    raise exception using errcode = '55000', message = 'SUPPLIER_CODE_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create function procurement.protect_purchase_order()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'PURCHASE_ORDER_DELETE_FORBIDDEN';
  end if;
  if old.status in ('CLOSED', 'CANCELLED') then
    raise exception using errcode = '55000', message = 'PURCHASE_ORDER_ALREADY_TERMINAL';
  end if;
  if old.status <> 'DRAFT' and (
    new.supplier_id is distinct from old.supplier_id
    or new.currency_code is distinct from old.currency_code
    or new.order_type is distinct from old.order_type
  ) then
    raise exception using errcode = '55000', message = 'APPROVED_PO_COMMERCIAL_IMMUTABLE';
  end if;
  if (old.status = 'DRAFT' and new.status not in ('DRAFT', 'APPROVED', 'CANCELLED'))
    or (old.status = 'APPROVED' and new.status not in ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'))
    or (old.status = 'PARTIALLY_RECEIVED' and new.status not in ('PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'))
    or (old.status = 'RECEIVED' and new.status not in ('RECEIVED', 'CLOSED'))
  then
    raise exception using errcode = '55000', message = 'PURCHASE_ORDER_STATE_INVALID';
  end if;
  return new;
end
$function$;

create function procurement.protect_purchase_order_line()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  po_status text;
begin
  select status into po_status from procurement.purchase_orders
  where tenant_id = coalesce(new.tenant_id, old.tenant_id)
    and id = coalesce(new.purchase_order_id, old.purchase_order_id);
  if po_status is distinct from 'DRAFT' then
    raise exception using errcode = '55000', message = 'APPROVED_PO_COMMERCIAL_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create function procurement.validate_purchase_order_line()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  po_supplier uuid;
  offer_supplier uuid;
  offer_material uuid;
begin
  select supplier_id into po_supplier from procurement.purchase_orders
  where tenant_id = new.tenant_id and id = new.purchase_order_id;
  if po_supplier is null then
    raise exception using errcode = '23503', message = 'PURCHASE_ORDER_NOT_FOUND';
  end if;
  if new.supplier_offer_id is not null then
    select supplier_id, material_id into offer_supplier, offer_material
    from procurement.supplier_material_offers
    where tenant_id = new.tenant_id and id = new.supplier_offer_id;
    if offer_supplier is distinct from po_supplier or offer_material is distinct from new.material_id then
      raise exception using errcode = '23514', message = 'SUPPLIER_OFFER_MISMATCH';
    end if;
  end if;
  return new;
end
$function$;

create function procurement.protect_goods_receipt()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  invalid_line boolean;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'GOODS_RECEIPT_DELETE_FORBIDDEN';
  end if;
  if old.status in ('POSTED', 'CANCELLED') then
    raise exception using errcode = '55000', message = 'GOODS_RECEIPT_ALREADY_TERMINAL';
  end if;
  if old.status = 'DRAFT' and new.status not in ('DRAFT', 'POSTED', 'CANCELLED') then
    raise exception using errcode = '55000', message = 'GOODS_RECEIPT_STATE_INVALID';
  end if;
  if new.status = 'POSTED' then
    select exists (
      select 1 from procurement.goods_receipt_lines
      where tenant_id = new.tenant_id and goods_receipt_id = new.id
        and (inventory_lot_id is null or inventory_movement_id is null)
    ) into invalid_line;
    if invalid_line then
      raise exception using errcode = '23514', message = 'INVENTORY_RECEIPT_UNAVAILABLE';
    end if;
  end if;
  return new;
end
$function$;

create function procurement.protect_goods_receipt_line()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  receipt_status text;
begin
  select status into receipt_status from procurement.goods_receipts
  where tenant_id = coalesce(new.tenant_id, old.tenant_id)
    and id = coalesce(new.goods_receipt_id, old.goods_receipt_id);
  if receipt_status is distinct from 'DRAFT' then
    raise exception using errcode = '55000', message = 'POSTED_RECEIPT_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create function procurement.validate_goods_receipt()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  po_supplier uuid;
begin
  select supplier_id into po_supplier from procurement.purchase_orders
  where tenant_id = new.tenant_id and id = new.purchase_order_id;
  if po_supplier is distinct from new.supplier_id then
    raise exception using errcode = '23514', message = 'RECEIPT_SUPPLIER_MISMATCH';
  end if;
  return new;
end
$function$;

create function procurement.validate_goods_receipt_line()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  receipt_po uuid;
  line_po uuid;
  line_material uuid;
begin
  select purchase_order_id into receipt_po from procurement.goods_receipts
  where tenant_id = new.tenant_id and id = new.goods_receipt_id;
  select purchase_order_id, material_id into line_po, line_material
  from procurement.purchase_order_lines
  where tenant_id = new.tenant_id and id = new.purchase_order_line_id;
  if receipt_po is distinct from line_po then
    raise exception using errcode = '23514', message = 'RECEIPT_PO_MISMATCH';
  end if;
  if new.material_id is distinct from line_material then
    raise exception using errcode = '23514', message = 'RECEIPT_MATERIAL_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger supplier_history_protection
before update or delete on procurement.suppliers
for each row execute function procurement.protect_supplier();
create trigger supplier_offer_material_access
before insert or update of tenant_id, material_id on procurement.supplier_material_offers
for each row execute function procurement.assert_material_access();
create trigger purchase_order_protection
before update or delete on procurement.purchase_orders
for each row execute function procurement.protect_purchase_order();
create trigger purchase_order_line_protection
before update or delete on procurement.purchase_order_lines
for each row execute function procurement.protect_purchase_order_line();
create trigger purchase_order_line_validation
before insert or update on procurement.purchase_order_lines
for each row execute function procurement.validate_purchase_order_line();
create trigger purchase_order_line_material_access
before insert or update of tenant_id, material_id on procurement.purchase_order_lines
for each row execute function procurement.assert_material_access();
create trigger goods_receipt_validation
before insert or update of tenant_id, purchase_order_id, supplier_id on procurement.goods_receipts
for each row execute function procurement.validate_goods_receipt();
create trigger goods_receipt_protection
before update or delete on procurement.goods_receipts
for each row execute function procurement.protect_goods_receipt();
create trigger goods_receipt_line_protection
before update or delete on procurement.goods_receipt_lines
for each row execute function procurement.protect_goods_receipt_line();
create trigger goods_receipt_line_validation
before insert or update on procurement.goods_receipt_lines
for each row execute function procurement.validate_goods_receipt_line();
create trigger goods_receipt_line_material_access
before insert or update of tenant_id, material_id on procurement.goods_receipt_lines
for each row execute function procurement.assert_material_access();

create index suppliers_tenant_status_idx on procurement.suppliers(tenant_id, status, display_name);
create index offers_tenant_supplier_status_idx on procurement.supplier_material_offers(tenant_id, supplier_id, status);
create index offers_tenant_material_idx on procurement.supplier_material_offers(tenant_id, material_id);
create index po_tenant_status_updated_idx on procurement.purchase_orders(tenant_id, status, updated_at desc);
create index po_lines_tenant_material_idx on procurement.purchase_order_lines(tenant_id, material_id);
create index receipts_tenant_po_status_idx on procurement.goods_receipts(tenant_id, purchase_order_id, status);
create index receipt_lines_tenant_po_line_idx on procurement.goods_receipt_lines(tenant_id, purchase_order_line_id);

alter table procurement.suppliers enable row level security;
alter table procurement.suppliers force row level security;
alter table procurement.supplier_material_offers enable row level security;
alter table procurement.supplier_material_offers force row level security;
alter table procurement.purchase_orders enable row level security;
alter table procurement.purchase_orders force row level security;
alter table procurement.purchase_order_lines enable row level security;
alter table procurement.purchase_order_lines force row level security;
alter table procurement.goods_receipts enable row level security;
alter table procurement.goods_receipts force row level security;
alter table procurement.goods_receipt_lines enable row level security;
alter table procurement.goods_receipt_lines force row level security;

create policy suppliers_runtime_access on procurement.suppliers for all to nox_app_runtime using (true) with check (true);
create policy offers_runtime_access on procurement.supplier_material_offers for all to nox_app_runtime using (true) with check (true);
create policy purchase_orders_runtime_access on procurement.purchase_orders for all to nox_app_runtime using (true) with check (true);
create policy purchase_order_lines_runtime_access on procurement.purchase_order_lines for all to nox_app_runtime using (true) with check (true);
create policy goods_receipts_runtime_access on procurement.goods_receipts for all to nox_app_runtime using (true) with check (true);
create policy goods_receipt_lines_runtime_access on procurement.goods_receipt_lines for all to nox_app_runtime using (true) with check (true);

revoke all on all tables in schema procurement from public;
revoke all on all tables in schema procurement from anon, authenticated;
grant select, insert, update on procurement.suppliers to nox_app_runtime;
grant select, insert, update on procurement.supplier_material_offers to nox_app_runtime;
grant select, insert, update on procurement.purchase_orders to nox_app_runtime;
grant select, insert, update, delete on procurement.purchase_order_lines to nox_app_runtime;
grant select, insert, update on procurement.goods_receipts to nox_app_runtime;
grant select, insert, update, delete on procurement.goods_receipt_lines to nox_app_runtime;

revoke all on all functions in schema procurement from public;

commit;

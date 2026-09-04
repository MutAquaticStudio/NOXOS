-- Gate 13 owns commercial offer, order, allocation, fulfillment and shipment
-- truth only. Customer, Project, Formula, Inventory, Batch and QC remain upstream.

create schema if not exists commercial;
revoke all on schema commercial from public, anon, authenticated;
grant usage on schema commercial to nox_app_runtime;

create table commercial.quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  quote_number text not null check (char_length(trim(quote_number)) between 1 and 80),
  revision_number integer not null check (revision_number > 0),
  supersedes_quote_id uuid null references commercial.quotes(id),
  customer_id uuid not null,
  customer_contact_id uuid null,
  source_service_order_id uuid null,
  source_project_id uuid null,
  status text not null check (status in ('DRAFT','ISSUED','ACCEPTED','DECLINED','CANCELLED')),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  valid_until timestamptz null,
  commercial_terms text null,
  payment_terms_text text null,
  shipping_terms_text text null,
  customer_code_snapshot text null,
  customer_display_name_snapshot text null,
  customer_legal_name_snapshot text null,
  customer_tax_identifier_snapshot text null,
  customer_country_code_snapshot text null,
  contact_snapshot jsonb null,
  ship_to_snapshot jsonb null,
  created_by_user_id uuid not null,
  issued_by_user_id uuid null,
  accepted_by_user_id uuid null,
  declined_by_user_id uuid null,
  cancelled_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz null,
  accepted_at timestamptz null,
  declined_at timestamptz null,
  cancelled_at timestamptz null,
  unique (tenant_id, quote_number, revision_number),
  check (valid_until is null or issued_at is null or valid_until >= issued_at),
  -- ISSUE is retained as historical evidence after ACCEPT/DECLINE/CANCEL.
  check (status not in ('ISSUED','ACCEPTED','DECLINED') or issued_at is not null),
  check (issued_at is null or status in ('ISSUED','ACCEPTED','DECLINED','CANCELLED')),
  check ((status = 'ACCEPTED') = (accepted_at is not null)),
  check ((status = 'DECLINED') = (declined_at is not null)),
  check ((status = 'CANCELLED') = (cancelled_at is not null))
);

create table commercial.quote_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  quote_id uuid not null references commercial.quotes(id) on delete restrict,
  line_order integer not null check (line_order > 0),
  line_kind text not null check (line_kind in ('MATERIAL','SERVICE_SCOPE','MANUFACTURED_PRODUCT')),
  title_snapshot text not null check (char_length(trim(title_snapshot)) between 1 and 300),
  description_snapshot text null,
  material_id uuid null,
  service_order_line_id uuid null,
  formula_version_id uuid null,
  quantity_kind text not null check (quantity_kind in ('MASS_MG','UNIT_COUNT')),
  quantity_value bigint not null check (quantity_value > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  price_basis_quantity bigint not null check (price_basis_quantity > 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, quote_id, line_order),
  check (
    (line_kind = 'MATERIAL' and material_id is not null and service_order_line_id is null and formula_version_id is null and quantity_kind = 'MASS_MG') or
    (line_kind = 'SERVICE_SCOPE' and material_id is null and service_order_line_id is not null and formula_version_id is null and quantity_kind = 'UNIT_COUNT' and quantity_value = 1 and price_basis_quantity = 1) or
    (line_kind = 'MANUFACTURED_PRODUCT' and material_id is null and service_order_line_id is null and formula_version_id is not null and quantity_kind = 'MASS_MG')
  ),
  check (discount_minor <= ((quantity_value * unit_price_minor + price_basis_quantity / 2) / price_basis_quantity))
);

create table commercial.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_number text not null check (char_length(trim(order_number)) between 1 and 80),
  source_quote_id uuid null unique references commercial.quotes(id),
  customer_id uuid not null,
  customer_contact_id uuid null,
  source_service_order_id uuid null,
  source_project_id uuid null,
  status text not null check (status in ('DRAFT','CONFIRMED','CANCELLED','CLOSED')),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  commercial_terms text null,
  payment_terms_text text null,
  shipping_terms_text text null,
  customer_code_snapshot text null,
  customer_display_name_snapshot text null,
  customer_legal_name_snapshot text null,
  customer_tax_identifier_snapshot text null,
  customer_country_code_snapshot text null,
  contact_snapshot jsonb null,
  ship_to_snapshot jsonb null,
  cancellation_reason text null,
  created_by_user_id uuid not null,
  confirmed_by_user_id uuid null,
  cancelled_by_user_id uuid null,
  closed_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz null,
  cancelled_at timestamptz null,
  closed_at timestamptz null,
  unique (tenant_id, order_number),
  -- A confirmed order may later be CANCELLED or CLOSED without losing its confirmation history.
  check (status not in ('CONFIRMED','CLOSED') or confirmed_at is not null),
  check (confirmed_at is null or status in ('CONFIRMED','CANCELLED','CLOSED')),
  check ((status = 'CANCELLED') = (cancelled_at is not null)),
  check ((status = 'CLOSED') = (closed_at is not null)),
  check (status <> 'CANCELLED' or cancellation_reason is not null)
);

create table commercial.order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null references commercial.orders(id) on delete restrict,
  line_order integer not null check (line_order > 0),
  line_kind text not null check (line_kind in ('MATERIAL','SERVICE_SCOPE','MANUFACTURED_PRODUCT')),
  title_snapshot text not null check (char_length(trim(title_snapshot)) between 1 and 300),
  description_snapshot text null,
  material_id uuid null,
  service_order_line_id uuid null,
  formula_version_id uuid null,
  quantity_kind text not null check (quantity_kind in ('MASS_MG','UNIT_COUNT')),
  ordered_quantity bigint not null check (ordered_quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  price_basis_quantity bigint not null check (price_basis_quantity > 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_id, line_order),
  check (
    (line_kind = 'MATERIAL' and material_id is not null and service_order_line_id is null and formula_version_id is null and quantity_kind = 'MASS_MG') or
    (line_kind = 'SERVICE_SCOPE' and material_id is null and service_order_line_id is not null and formula_version_id is null and quantity_kind = 'UNIT_COUNT' and ordered_quantity = 1 and price_basis_quantity = 1) or
    (line_kind = 'MANUFACTURED_PRODUCT' and material_id is null and service_order_line_id is null and formula_version_id is not null and quantity_kind = 'MASS_MG')
  ),
  check (discount_minor <= ((ordered_quantity * unit_price_minor + price_basis_quantity / 2) / price_basis_quantity))
);

create table commercial.order_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null references commercial.orders(id) on delete restrict,
  order_line_id uuid not null references commercial.order_lines(id) on delete restrict,
  allocation_type text not null check (allocation_type in ('MATERIAL_LOT','RELEASED_BATCH')),
  quantity_value bigint not null check (quantity_value > 0),
  material_lot_id uuid null,
  location_id uuid null,
  inventory_reservation_id uuid null,
  production_batch_id uuid null,
  batch_release_decision_id uuid null,
  state text not null check (state in ('ACTIVE','RELEASED','CONSUMED')),
  created_by_user_id uuid not null,
  released_by_user_id uuid null,
  consumed_by_user_id uuid null,
  created_at timestamptz not null default now(),
  released_at timestamptz null,
  consumed_at timestamptz null,
  unique (inventory_reservation_id),
  check (
    (allocation_type = 'MATERIAL_LOT' and material_lot_id is not null and location_id is not null and inventory_reservation_id is not null and production_batch_id is null and batch_release_decision_id is null) or
    (allocation_type = 'RELEASED_BATCH' and material_lot_id is null and location_id is null and inventory_reservation_id is null and production_batch_id is not null and batch_release_decision_id is not null)
  ),
  check ((state = 'RELEASED') = (released_at is not null)),
  check ((state = 'CONSUMED') = (consumed_at is not null))
);

create table commercial.fulfillments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  fulfillment_number text not null check (char_length(trim(fulfillment_number)) between 1 and 80),
  order_id uuid not null references commercial.orders(id) on delete restrict,
  status text not null check (status in ('DRAFT','CONFIRMED','CANCELLED')),
  notes text null,
  created_by_user_id uuid not null,
  confirmed_by_user_id uuid null,
  cancelled_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz null,
  cancelled_at timestamptz null,
  unique (tenant_id, fulfillment_number),
  check ((status = 'CONFIRMED') = (confirmed_at is not null)),
  check ((status = 'CANCELLED') = (cancelled_at is not null))
);

create table commercial.fulfillment_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  fulfillment_id uuid not null references commercial.fulfillments(id) on delete restrict,
  order_line_id uuid not null references commercial.order_lines(id) on delete restrict,
  allocation_id uuid null references commercial.order_allocations(id) on delete restrict,
  quantity_value bigint not null check (quantity_value > 0),
  created_at timestamptz not null default now(),
  unique (fulfillment_id, order_line_id, allocation_id)
);

create table commercial.shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  shipment_number text not null check (char_length(trim(shipment_number)) between 1 and 80),
  fulfillment_id uuid not null unique references commercial.fulfillments(id) on delete restrict,
  status text not null check (status in ('DRAFT','SHIPPED','DELIVERED','CANCELLED')),
  ship_to_snapshot jsonb not null,
  carrier_name text null,
  service_level text null,
  tracking_number text null,
  notes text null,
  cancellation_reason text null,
  created_by_user_id uuid not null,
  shipped_by_user_id uuid null,
  delivered_by_user_id uuid null,
  cancelled_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shipped_at timestamptz null,
  delivered_at timestamptz null,
  cancelled_at timestamptz null,
  unique (tenant_id, shipment_number),
  -- DELIVERED retains the preceding shipment timestamp as immutable history.
  check (status not in ('SHIPPED','DELIVERED') or shipped_at is not null),
  check (shipped_at is null or status in ('SHIPPED','DELIVERED')),
  check ((status = 'DELIVERED') = (delivered_at is not null)),
  check ((status = 'CANCELLED') = (cancelled_at is not null)),
  check (delivered_at is null or shipped_at is not null),
  check (status <> 'CANCELLED' or cancellation_reason is not null)
);

create index commercial_quotes_tenant_status_idx on commercial.quotes(tenant_id, status, updated_at desc);
create index commercial_orders_tenant_status_idx on commercial.orders(tenant_id, status, updated_at desc);
create index commercial_order_lines_order_idx on commercial.order_lines(tenant_id, order_id, line_order);
create index commercial_allocations_order_line_idx on commercial.order_allocations(tenant_id, order_line_id, state);
create index commercial_allocations_batch_idx on commercial.order_allocations(tenant_id, production_batch_id, state) where allocation_type = 'RELEASED_BATCH';
create index commercial_fulfillments_order_idx on commercial.fulfillments(tenant_id, order_id, status);
create index commercial_fulfillment_lines_order_idx on commercial.fulfillment_lines(tenant_id, order_line_id);

create or replace function commercial.enforce_parent_immutability()
returns trigger language plpgsql set search_path = commercial, pg_temp as $$
declare parent_status text; row_tenant uuid; parent_id uuid;
begin
  row_tenant := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  if tg_table_name = 'quote_lines' then
    parent_id := case when tg_op = 'DELETE' then old.quote_id else new.quote_id end;
    select status into parent_status from commercial.quotes
      where tenant_id = row_tenant and id = parent_id for update;
    if parent_status <> 'DRAFT' then raise exception using errcode = '55000', message = 'COMMERCIAL_QUOTE_NOT_EDITABLE'; end if;
  elsif tg_table_name = 'order_lines' then
    parent_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
    select status into parent_status from commercial.orders
      where tenant_id = row_tenant and id = parent_id for update;
    if parent_status <> 'DRAFT' then raise exception using errcode = '55000', message = 'COMMERCIAL_ORDER_NOT_EDITABLE'; end if;
  end if;
  if parent_status is null then raise exception using errcode = '55000', message = 'COMMERCIAL_LINE_INVALID'; end if;
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or (tg_table_name = 'quote_lines' and new.quote_id is distinct from old.quote_id)
    or (tg_table_name = 'order_lines' and new.order_id is distinct from old.order_id)
  ) then raise exception using errcode = '55000', message = 'COMMERCIAL_LINE_INVALID'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger commercial_quote_lines_mutable_before_issue
before insert or update or delete on commercial.quote_lines
for each row execute function commercial.enforce_parent_immutability();
create trigger commercial_order_lines_mutable_before_confirm
before insert or update or delete on commercial.order_lines
for each row execute function commercial.enforce_parent_immutability();

-- Lifecycle guards are deliberately table-local. Cross-Gate source state is
-- re-resolved by the application transaction at the consequential transition.
create function commercial.enforce_quote_lifecycle()
returns trigger language plpgsql set search_path = pg_catalog, commercial, lab_services as $$
declare contact_customer uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then raise exception 'COMMERCIAL_QUOTE_NOT_ISSUABLE' using errcode = 'P0001'; end if;
  else
    if old.status in ('ACCEPTED','DECLINED','CANCELLED') and new is distinct from old then
      raise exception 'COMMERCIAL_QUOTE_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    if old.status = 'DRAFT' and new.status not in ('DRAFT','ISSUED','CANCELLED') then
      raise exception 'COMMERCIAL_QUOTE_NOT_ISSUABLE' using errcode = 'P0001';
    elsif old.status = 'ISSUED' and new.status not in ('ISSUED','ACCEPTED','DECLINED','CANCELLED') then
      raise exception 'COMMERCIAL_QUOTE_ALREADY_TERMINAL' using errcode = 'P0001';
    end if;
    if old.status <> 'DRAFT' and (
      new.tenant_id is distinct from old.tenant_id or new.quote_number is distinct from old.quote_number
      or new.revision_number is distinct from old.revision_number or new.supersedes_quote_id is distinct from old.supersedes_quote_id
      or new.customer_id is distinct from old.customer_id or new.customer_contact_id is distinct from old.customer_contact_id
      or new.source_service_order_id is distinct from old.source_service_order_id or new.source_project_id is distinct from old.source_project_id
      or new.currency_code is distinct from old.currency_code or new.valid_until is distinct from old.valid_until
      or new.commercial_terms is distinct from old.commercial_terms or new.payment_terms_text is distinct from old.payment_terms_text
      or new.shipping_terms_text is distinct from old.shipping_terms_text or new.ship_to_snapshot is distinct from old.ship_to_snapshot
      or new.customer_code_snapshot is distinct from old.customer_code_snapshot
      or new.customer_display_name_snapshot is distinct from old.customer_display_name_snapshot
      or new.customer_legal_name_snapshot is distinct from old.customer_legal_name_snapshot
      or new.customer_tax_identifier_snapshot is distinct from old.customer_tax_identifier_snapshot
      or new.customer_country_code_snapshot is distinct from old.customer_country_code_snapshot
      or new.contact_snapshot is distinct from old.contact_snapshot
    ) then raise exception 'COMMERCIAL_QUOTE_NOT_EDITABLE' using errcode = 'P0001'; end if;
  end if;
  if new.customer_contact_id is not null then
    select customer_id into contact_customer from lab_services.customer_contacts
      where tenant_id = new.tenant_id and id = new.customer_contact_id;
    if contact_customer is distinct from new.customer_id then
      raise exception 'COMMERCIAL_ORDER_SOURCE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger commercial_quote_lifecycle before insert or update on commercial.quotes
for each row execute function commercial.enforce_quote_lifecycle();

create function commercial.enforce_order_lifecycle()
returns trigger language plpgsql set search_path = pg_catalog, commercial, lab_services as $$
declare contact_customer uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then raise exception 'COMMERCIAL_ORDER_NOT_CONFIRMABLE' using errcode = 'P0001'; end if;
  else
    if old.status in ('CANCELLED','CLOSED') and new is distinct from old then
      raise exception 'COMMERCIAL_ORDER_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    if old.status = 'DRAFT' and new.status not in ('DRAFT','CONFIRMED','CANCELLED') then
      raise exception 'COMMERCIAL_ORDER_NOT_CONFIRMABLE' using errcode = 'P0001';
    elsif old.status = 'CONFIRMED' and new.status not in ('CONFIRMED','CANCELLED','CLOSED') then
      raise exception 'COMMERCIAL_ORDER_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    if old.status <> 'DRAFT' and (
      new.tenant_id is distinct from old.tenant_id or new.order_number is distinct from old.order_number
      or new.source_quote_id is distinct from old.source_quote_id or new.customer_id is distinct from old.customer_id
      or new.customer_contact_id is distinct from old.customer_contact_id
      or new.source_service_order_id is distinct from old.source_service_order_id or new.source_project_id is distinct from old.source_project_id
      or new.currency_code is distinct from old.currency_code or new.commercial_terms is distinct from old.commercial_terms
      or new.payment_terms_text is distinct from old.payment_terms_text or new.shipping_terms_text is distinct from old.shipping_terms_text
      or new.ship_to_snapshot is distinct from old.ship_to_snapshot
      or new.customer_code_snapshot is distinct from old.customer_code_snapshot
      or new.customer_display_name_snapshot is distinct from old.customer_display_name_snapshot
      or new.customer_legal_name_snapshot is distinct from old.customer_legal_name_snapshot
      or new.customer_tax_identifier_snapshot is distinct from old.customer_tax_identifier_snapshot
      or new.customer_country_code_snapshot is distinct from old.customer_country_code_snapshot
      or new.contact_snapshot is distinct from old.contact_snapshot
    ) then raise exception 'COMMERCIAL_ORDER_NOT_EDITABLE' using errcode = 'P0001'; end if;
  end if;
  if new.customer_contact_id is not null then
    select customer_id into contact_customer from lab_services.customer_contacts
      where tenant_id = new.tenant_id and id = new.customer_contact_id;
    if contact_customer is distinct from new.customer_id then
      raise exception 'COMMERCIAL_ORDER_SOURCE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger commercial_order_lifecycle before insert or update on commercial.orders
for each row execute function commercial.enforce_order_lifecycle();

create function commercial.enforce_fulfillment_lifecycle()
returns trigger language plpgsql set search_path = pg_catalog, commercial as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then raise exception 'COMMERCIAL_FULFILLMENT_NOT_EDITABLE' using errcode = 'P0001'; end if;
  else
    if old.status in ('CONFIRMED','CANCELLED') and new is distinct from old then
      raise exception 'COMMERCIAL_FULFILLMENT_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    if old.status = 'DRAFT' and new.status not in ('DRAFT','CONFIRMED','CANCELLED') then
      raise exception 'COMMERCIAL_FULFILLMENT_NOT_CONFIRMABLE' using errcode = 'P0001';
    end if;
    if old.status <> 'DRAFT' and (
      new.tenant_id is distinct from old.tenant_id or new.fulfillment_number is distinct from old.fulfillment_number
      or new.order_id is distinct from old.order_id or new.notes is distinct from old.notes
    ) then raise exception 'COMMERCIAL_FULFILLMENT_NOT_EDITABLE' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
create trigger commercial_fulfillment_lifecycle before insert or update on commercial.fulfillments
for each row execute function commercial.enforce_fulfillment_lifecycle();

create function commercial.enforce_allocation_lifecycle()
returns trigger language plpgsql set search_path = pg_catalog, commercial as $$
begin
  if old.state <> 'ACTIVE' and new is distinct from old then
    raise exception 'COMMERCIAL_ALLOCATION_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if old.state = 'ACTIVE' and new.state not in ('ACTIVE','RELEASED','CONSUMED') then
    raise exception 'COMMERCIAL_ALLOCATION_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.order_id is distinct from old.order_id
    or new.order_line_id is distinct from old.order_line_id or new.allocation_type is distinct from old.allocation_type
    or new.quantity_value is distinct from old.quantity_value or new.material_lot_id is distinct from old.material_lot_id
    or new.location_id is distinct from old.location_id or new.inventory_reservation_id is distinct from old.inventory_reservation_id
    or new.production_batch_id is distinct from old.production_batch_id or new.batch_release_decision_id is distinct from old.batch_release_decision_id
  then raise exception 'COMMERCIAL_ALLOCATION_NOT_ACTIVE' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger commercial_allocation_lifecycle before update on commercial.order_allocations
for each row execute function commercial.enforce_allocation_lifecycle();

create function commercial.enforce_fulfillment_line_mutability()
returns trigger language plpgsql set search_path = pg_catalog, commercial as $$
declare row_tenant uuid; row_fulfillment uuid; parent_order uuid; parent_status text;
        source_order_id uuid; source_line_kind text; allocation_line_id uuid;
begin
  row_tenant := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  row_fulfillment := case when tg_op = 'DELETE' then old.fulfillment_id else new.fulfillment_id end;
  select order_id, status into parent_order, parent_status from commercial.fulfillments
    where tenant_id = row_tenant and id = row_fulfillment for update;
  if parent_order is null or parent_status <> 'DRAFT' then raise exception 'COMMERCIAL_FULFILLMENT_NOT_EDITABLE' using errcode = 'P0001'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.fulfillment_id is distinct from old.fulfillment_id) then
    raise exception 'COMMERCIAL_FULFILLMENT_NOT_EDITABLE' using errcode = 'P0001';
  end if;
  select ol.order_id, ol.line_kind into source_order_id, source_line_kind from commercial.order_lines ol
    where ol.tenant_id = new.tenant_id and ol.id = new.order_line_id;
  if source_order_id is distinct from parent_order then raise exception 'COMMERCIAL_LINE_INVALID' using errcode = 'P0001'; end if;
  if source_line_kind = 'SERVICE_SCOPE' and (new.allocation_id is not null or new.quantity_value <> 1) then
    raise exception 'COMMERCIAL_LINE_INVALID' using errcode = 'P0001';
  end if;
  if source_line_kind <> 'SERVICE_SCOPE' then
    select oa.order_line_id into allocation_line_id from commercial.order_allocations oa
      where oa.tenant_id = new.tenant_id and oa.id = new.allocation_id;
    if new.allocation_id is null or allocation_line_id is distinct from new.order_line_id then
      raise exception 'COMMERCIAL_LINE_INVALID' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger commercial_fulfillment_lines_guard before insert or update or delete on commercial.fulfillment_lines
for each row execute function commercial.enforce_fulfillment_line_mutability();

create function commercial.enforce_shipment_lifecycle()
returns trigger language plpgsql set search_path = pg_catalog, commercial as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then raise exception 'COMMERCIAL_SHIPMENT_NOT_SHIPPABLE' using errcode = 'P0001'; end if;
  else
    if old.status in ('DELIVERED','CANCELLED') and new is distinct from old then
      raise exception 'COMMERCIAL_SHIPMENT_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    if old.status = 'DRAFT' and new.status not in ('DRAFT','SHIPPED','CANCELLED') then
      raise exception 'COMMERCIAL_SHIPMENT_NOT_SHIPPABLE' using errcode = 'P0001';
    elsif old.status = 'SHIPPED' and new.status not in ('SHIPPED','DELIVERED') then
      raise exception 'COMMERCIAL_SHIPMENT_NOT_DELIVERABLE' using errcode = 'P0001';
    end if;
    if old.status <> 'DRAFT' and (
      new.tenant_id is distinct from old.tenant_id or new.shipment_number is distinct from old.shipment_number
      or new.fulfillment_id is distinct from old.fulfillment_id or new.ship_to_snapshot is distinct from old.ship_to_snapshot
      or new.carrier_name is distinct from old.carrier_name or new.service_level is distinct from old.service_level
      or new.tracking_number is distinct from old.tracking_number or new.notes is distinct from old.notes
    ) then raise exception 'COMMERCIAL_SHIPMENT_NOT_EDITABLE' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
create trigger commercial_shipment_lifecycle before insert or update on commercial.shipments
for each row execute function commercial.enforce_shipment_lifecycle();

alter table commercial.quotes enable row level security;
alter table commercial.quotes force row level security;
alter table commercial.quote_lines enable row level security;
alter table commercial.quote_lines force row level security;
alter table commercial.orders enable row level security;
alter table commercial.orders force row level security;
alter table commercial.order_lines enable row level security;
alter table commercial.order_lines force row level security;
alter table commercial.order_allocations enable row level security;
alter table commercial.order_allocations force row level security;
alter table commercial.fulfillments enable row level security;
alter table commercial.fulfillments force row level security;
alter table commercial.fulfillment_lines enable row level security;
alter table commercial.fulfillment_lines force row level security;
alter table commercial.shipments enable row level security;
alter table commercial.shipments force row level security;

grant select, insert, update on all tables in schema commercial to nox_app_runtime;
grant delete on commercial.quote_lines, commercial.order_lines, commercial.fulfillment_lines to nox_app_runtime;
revoke all on all tables in schema commercial from public, anon, authenticated;

create policy commercial_runtime_access on commercial.quotes for all to nox_app_runtime using (true) with check (true);
create policy commercial_runtime_access on commercial.quote_lines for all to nox_app_runtime using (true) with check (true);
create policy commercial_runtime_access on commercial.orders for all to nox_app_runtime using (true) with check (true);
create policy commercial_runtime_access on commercial.order_lines for all to nox_app_runtime using (true) with check (true);
create policy commercial_runtime_access on commercial.order_allocations for all to nox_app_runtime using (true) with check (true);
create policy commercial_runtime_access on commercial.fulfillments for all to nox_app_runtime using (true) with check (true);
create policy commercial_runtime_access on commercial.fulfillment_lines for all to nox_app_runtime using (true) with check (true);
create policy commercial_runtime_access on commercial.shipments for all to nox_app_runtime using (true) with check (true);

-- This is the only upstream mutation in G13. It extends existing G7
-- provenance checks; reservation/movement state machines remain unchanged.
do $$
declare r record;
begin
  for r in select conname, conrelid::regclass as relation
    from pg_constraint
    where contype = 'c'
      and conrelid in ('inventory.stock_movements'::regclass, 'inventory.stock_reservations'::regclass)
      and pg_get_constraintdef(oid) like '%source_module%' loop
    execute format('alter table %s drop constraint %I', r.relation, r.conname);
  end loop;
end $$;
alter table inventory.stock_movements add constraint stock_movements_source_module_check
  check (source_module in ('MANUAL','TRIAL','PROCUREMENT','PRODUCTION','COMMERCIAL'));
alter table inventory.stock_movements add constraint stock_movements_source_reference_check
  check (source_module = 'MANUAL' or (source_module in ('TRIAL','PROCUREMENT','PRODUCTION','COMMERCIAL') and source_reference_id is not null));
alter table inventory.stock_reservations add constraint stock_reservations_source_module_check
  check (source_module in ('MANUAL','TRIAL','PRODUCTION','COMMERCIAL'));
alter table inventory.stock_reservations add constraint stock_reservations_source_reference_check
  check (source_module = 'MANUAL' or (source_module in ('TRIAL','PRODUCTION','COMMERCIAL') and source_reference_id is not null));

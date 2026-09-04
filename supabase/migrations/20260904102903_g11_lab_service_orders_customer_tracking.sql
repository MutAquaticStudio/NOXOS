-- Gate 11: canonical Customer master and NØX Lab Service Order authority.
-- Private, server-only schema. G4 Project/Brief, G10 Batch Release, G12 Project
-- Operations, and G13 Commercial Order authorities remain outside this boundary.

create schema if not exists lab_services;
revoke all on schema lab_services from public, anon, authenticated;
grant usage on schema lab_services to nox_app_runtime;

create table lab_services.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  customer_code text not null check (length(btrim(customer_code)) between 1 and 80),
  customer_type text not null check (customer_type in ('INDIVIDUAL', 'BUSINESS')),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  legal_name text null,
  tax_identifier text null,
  country_code text null check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  status text not null default 'PROSPECT' check (status in ('PROSPECT', 'ACTIVE', 'ON_HOLD', 'ARCHIVED')),
  notes text null,
  created_by_user_id uuid not null references platform.platform_users(id),
  held_by_user_id uuid null references platform.platform_users(id),
  archived_by_user_id uuid null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  held_at timestamptz null,
  archived_at timestamptz null,
  unique (tenant_id, customer_code),
  unique (tenant_id, id)
);

create table lab_services.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  customer_id uuid not null,
  full_name text not null check (length(btrim(full_name)) between 1 and 200),
  email text null,
  phone text null,
  role_title text null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  is_primary boolean not null default false,
  created_by_user_id uuid not null references platform.platform_users(id),
  archived_by_user_id uuid null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id)
    references lab_services.customers(tenant_id, id)
);

create unique index customer_contacts_one_active_primary
  on lab_services.customer_contacts(tenant_id, customer_id)
  where status = 'ACTIVE' and is_primary;

create table lab_services.service_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  order_number text not null check (length(btrim(order_number)) between 1 and 80),
  customer_id uuid not null,
  customer_contact_id uuid null,
  customer_external_reference text null,
  intake_summary text not null check (length(btrim(intake_summary)) between 1 and 4000),
  requested_completion_date timestamptz null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  notes text null,
  cancellation_reason text null,
  created_by_user_id uuid not null references platform.platform_users(id),
  confirmed_by_user_id uuid null references platform.platform_users(id),
  started_by_user_id uuid null references platform.platform_users(id),
  completed_by_user_id uuid null references platform.platform_users(id),
  cancelled_by_user_id uuid null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz null,
  started_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  unique (tenant_id, order_number),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id)
    references lab_services.customers(tenant_id, id),
  foreign key (tenant_id, customer_contact_id)
    references lab_services.customer_contacts(tenant_id, id)
);

create table lab_services.service_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  service_order_id uuid not null,
  line_order integer not null check (line_order > 0),
  service_type text not null check (service_type in (
    'FORMULATION_RND', 'TRIAL_EVALUATION', 'TECHNICAL_CONSULTING',
    'PRODUCTION_SUPPORT', 'OTHER'
  )),
  title text not null check (length(btrim(title)) between 1 and 200),
  scope_description text not null check (length(btrim(scope_description)) between 1 and 4000),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, service_order_id, line_order),
  foreign key (tenant_id, service_order_id)
    references lab_services.service_orders(tenant_id, id)
);

create table lab_services.customer_interactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  customer_id uuid not null,
  service_order_id uuid null,
  interaction_type text not null check (interaction_type in ('EMAIL', 'CALL', 'MEETING', 'NOTE', 'OTHER')),
  occurred_at timestamptz not null,
  summary text not null check (length(btrim(summary)) between 1 and 4000),
  next_action_text text null,
  next_action_date timestamptz null,
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, customer_id)
    references lab_services.customers(tenant_id, id),
  foreign key (tenant_id, service_order_id)
    references lab_services.service_orders(tenant_id, id)
);

create index customers_tenant_status_updated
  on lab_services.customers(tenant_id, status, updated_at desc);
create index contacts_customer_status
  on lab_services.customer_contacts(tenant_id, customer_id, status);
create index service_orders_customer_status
  on lab_services.service_orders(tenant_id, customer_id, status, updated_at desc);
create index service_orders_tenant_status
  on lab_services.service_orders(tenant_id, status, updated_at desc);
create index customer_interactions_timeline
  on lab_services.customer_interactions(tenant_id, customer_id, occurred_at desc);

create function lab_services.enforce_customer_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'ARCHIVED' and new is distinct from old then
    raise exception using errcode = 'P0001', message = 'LAB_CUSTOMER_ARCHIVED';
  end if;
  if new.customer_code is distinct from old.customer_code and exists (
    select 1 from lab_services.service_orders
    where tenant_id = old.tenant_id and customer_id = old.id
  ) then
    raise exception using errcode = 'P0001', message = 'LAB_CUSTOMER_CODE_CONFLICT';
  end if;
  if new.status = 'ARCHIVED' and old.status <> 'ARCHIVED' and exists (
    select 1 from lab_services.service_orders
    where tenant_id = old.tenant_id and customer_id = old.id
      and status in ('DRAFT', 'CONFIRMED', 'IN_PROGRESS')
  ) then
    raise exception using errcode = 'P0001', message = 'LAB_CUSTOMER_HAS_OPEN_ORDERS';
  end if;
  return new;
end;
$$;

create trigger customers_history_guard
before update on lab_services.customers
for each row execute function lab_services.enforce_customer_history();

create function lab_services.enforce_contact_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  customer_status text;
begin
  if tg_op = 'UPDATE' then
    if new.customer_id is distinct from old.customer_id
      or new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode = 'P0001', message = 'LAB_CONTACT_CUSTOMER_MISMATCH';
    end if;
    if old.status = 'ARCHIVED' and new is distinct from old then
      raise exception using errcode = 'P0001', message = 'LAB_CONTACT_NOT_ACTIVE';
    end if;
  end if;
  select status into customer_status
    from lab_services.customers
    where tenant_id = new.tenant_id and id = new.customer_id;
  if customer_status = 'ARCHIVED' then
    raise exception using errcode = 'P0001', message = 'LAB_CUSTOMER_ARCHIVED';
  end if;
  if new.status = 'ARCHIVED' then
    new.is_primary := false;
  end if;
  return new;
end;
$$;

create trigger contacts_history_guard
before insert or update on lab_services.customer_contacts
for each row execute function lab_services.enforce_contact_history();

create function lab_services.enforce_service_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  customer_status text;
  contact_customer uuid;
  contact_status text;
begin
  if tg_op = 'INSERT' then
    select status into customer_status from lab_services.customers
      where tenant_id = new.tenant_id and id = new.customer_id;
    if customer_status not in ('PROSPECT', 'ACTIVE') then
      raise exception using errcode = 'P0001', message = 'LAB_CUSTOMER_NOT_ACTIVE';
    end if;
  else
    if old.status = 'COMPLETED' or old.status = 'CANCELLED' then
      if new is distinct from old then
        raise exception using errcode = 'P0001', message = 'LAB_SERVICE_ORDER_ALREADY_TERMINAL';
      end if;
    elsif old.status = 'DRAFT' and new.status not in ('DRAFT', 'CONFIRMED', 'CANCELLED') then
      raise exception using errcode = 'P0001', message = 'LAB_SERVICE_ORDER_NOT_CONFIRMABLE';
    elsif old.status = 'CONFIRMED' and new.status not in ('CONFIRMED', 'IN_PROGRESS', 'CANCELLED') then
      raise exception using errcode = 'P0001', message = 'LAB_SERVICE_ORDER_NOT_EDITABLE';
    elsif old.status = 'IN_PROGRESS' and new.status not in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') then
      raise exception using errcode = 'P0001', message = 'LAB_SERVICE_ORDER_NOT_EDITABLE';
    end if;
    if old.status <> 'DRAFT' and (
      new.customer_id is distinct from old.customer_id
      or new.customer_contact_id is distinct from old.customer_contact_id
      or new.customer_external_reference is distinct from old.customer_external_reference
      or new.intake_summary is distinct from old.intake_summary
    ) then
      raise exception using errcode = 'P0001', message = 'LAB_SERVICE_ORDER_SCOPE_IMMUTABLE';
    end if;
  end if;

  if new.customer_contact_id is not null then
    select customer_id, status into contact_customer, contact_status
      from lab_services.customer_contacts
      where tenant_id = new.tenant_id and id = new.customer_contact_id;
    if contact_customer is distinct from new.customer_id then
      raise exception using errcode = 'P0001', message = 'LAB_SERVICE_ORDER_CONTACT_INVALID';
    end if;
    if contact_status <> 'ACTIVE' then
      raise exception using errcode = 'P0001', message = 'LAB_CONTACT_NOT_ACTIVE';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'CONFIRMED' and old.status = 'DRAFT' then
    select status into customer_status from lab_services.customers
      where tenant_id = new.tenant_id and id = new.customer_id;
    if customer_status <> 'ACTIVE' then
      raise exception using errcode = 'P0001', message = 'LAB_CUSTOMER_NOT_ACTIVE';
    end if;
    if not exists (
      select 1 from lab_services.service_order_lines
      where tenant_id = new.tenant_id and service_order_id = new.id
    ) then
      raise exception using errcode = 'P0001', message = 'LAB_SERVICE_ORDER_LINES_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;

create trigger service_orders_guard
before insert or update on lab_services.service_orders
for each row execute function lab_services.enforce_service_order();

create function lab_services.enforce_service_order_line_mutability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_tenant uuid;
  parent_status text;
begin
  if tg_op = 'DELETE' then
    select tenant_id, status into parent_tenant, parent_status
      from lab_services.service_orders
      where tenant_id = old.tenant_id and id = old.service_order_id
      for update;
  else
    select tenant_id, status into parent_tenant, parent_status
      from lab_services.service_orders
      where tenant_id = new.tenant_id and id = new.service_order_id
      for update;
  end if;
  if parent_status <> 'DRAFT' then
    raise exception using errcode = 'P0001', message = 'LAB_SERVICE_ORDER_SCOPE_IMMUTABLE';
  end if;
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.service_order_id is distinct from old.service_order_id
  ) then
    raise exception using errcode = 'P0001', message = 'LAB_SERVICE_ORDER_SCOPE_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger service_order_lines_guard
before insert or update or delete on lab_services.service_order_lines
for each row execute function lab_services.enforce_service_order_line_mutability();

create function lab_services.enforce_interaction_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_customer uuid;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = 'P0001', message = 'LAB_INTERACTION_INVALID';
  end if;
  if new.service_order_id is not null then
    select customer_id into order_customer from lab_services.service_orders
      where tenant_id = new.tenant_id and id = new.service_order_id;
    if order_customer is distinct from new.customer_id then
      raise exception using errcode = 'P0001', message = 'LAB_INTERACTION_ORDER_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

create trigger customer_interactions_guard
before insert or update or delete on lab_services.customer_interactions
for each row execute function lab_services.enforce_interaction_integrity();

alter table lab_services.customers enable row level security;
alter table lab_services.customers force row level security;
alter table lab_services.customer_contacts enable row level security;
alter table lab_services.customer_contacts force row level security;
alter table lab_services.service_orders enable row level security;
alter table lab_services.service_orders force row level security;
alter table lab_services.service_order_lines enable row level security;
alter table lab_services.service_order_lines force row level security;
alter table lab_services.customer_interactions enable row level security;
alter table lab_services.customer_interactions force row level security;

create policy customers_runtime_all on lab_services.customers
  for all to nox_app_runtime using (true) with check (true);
create policy customer_contacts_runtime_all on lab_services.customer_contacts
  for all to nox_app_runtime using (true) with check (true);
create policy service_orders_runtime_all on lab_services.service_orders
  for all to nox_app_runtime using (true) with check (true);
create policy service_order_lines_runtime_all on lab_services.service_order_lines
  for all to nox_app_runtime using (true) with check (true);
create policy customer_interactions_runtime_read_insert on lab_services.customer_interactions
  for select to nox_app_runtime using (true);
create policy customer_interactions_runtime_insert on lab_services.customer_interactions
  for insert to nox_app_runtime with check (true);

revoke all on all tables in schema lab_services from public, anon, authenticated;
grant select, insert, update on lab_services.customers to nox_app_runtime;
grant select, insert, update on lab_services.customer_contacts to nox_app_runtime;
grant select, insert, update on lab_services.service_orders to nox_app_runtime;
grant select, insert, update, delete on lab_services.service_order_lines to nox_app_runtime;
grant select, insert on lab_services.customer_interactions to nox_app_runtime;

revoke all on all functions in schema lab_services from public, anon, authenticated;
grant execute on all functions in schema lab_services to nox_app_runtime;

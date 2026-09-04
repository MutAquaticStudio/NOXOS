-- Preserve the selected contact as historical Service Order provenance while
-- allowing a DRAFT order to be cancelled after that contact is archived.
-- Contact activity is authoritative when the relationship is established or
-- when an order is confirmed, not when an existing order is terminated.

create or replace function lab_services.enforce_service_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  customer_status text;
  contact_customer uuid;
  contact_status text;
  require_active_contact boolean := false;
begin
  if tg_op = 'INSERT' then
    select status into customer_status from lab_services.customers
      where tenant_id = new.tenant_id and id = new.customer_id;
    if customer_status not in ('PROSPECT', 'ACTIVE') then
      raise exception using errcode = 'P0001', message = 'LAB_CUSTOMER_NOT_ACTIVE';
    end if;
    require_active_contact := true;
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
    require_active_contact :=
      new.customer_contact_id is distinct from old.customer_contact_id
      or (old.status = 'DRAFT' and new.status = 'CONFIRMED');
  end if;

  if new.customer_contact_id is not null then
    select customer_id, status into contact_customer, contact_status
      from lab_services.customer_contacts
      where tenant_id = new.tenant_id and id = new.customer_contact_id;
    if contact_customer is distinct from new.customer_id then
      raise exception using errcode = 'P0001', message = 'LAB_SERVICE_ORDER_CONTACT_INVALID';
    end if;
    if require_active_contact and contact_status <> 'ACTIVE' then
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

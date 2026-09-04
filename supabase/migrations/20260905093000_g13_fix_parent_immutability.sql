-- G13 hotfix: a quote-line trigger must never dereference order_id, which only
-- exists on order_lines. Keep this as a version-controlled trigger repair;
-- it introduces no commercial truth or schema surface.

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
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode = '55000', message = 'COMMERCIAL_LINE_INVALID';
    end if;
    if tg_table_name = 'quote_lines' and new.quote_id is distinct from old.quote_id then
      raise exception using errcode = '55000', message = 'COMMERCIAL_LINE_INVALID';
    elsif tg_table_name = 'order_lines' and new.order_id is distinct from old.order_id then
      raise exception using errcode = '55000', message = 'COMMERCIAL_LINE_INVALID';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

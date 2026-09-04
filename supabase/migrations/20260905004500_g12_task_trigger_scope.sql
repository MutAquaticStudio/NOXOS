-- Repair the task-integrity trigger's PL/pgSQL column/variable ambiguity.
-- This is a behavior-only correction for the existing G12 task table.

begin;

create or replace function project_operations.enforce_task_integrity()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  resolved_project_status text;
  resolved_project_type text;
  source_order_id uuid;
  row_tenant uuid;
  row_project uuid;
begin
  if tg_op = 'DELETE' then
    row_tenant := old.tenant_id;
    row_project := old.project_id;
  else
    row_tenant := new.tenant_id;
    row_project := new.project_id;
  end if;
  select p.status, p.project_type, p.source_service_order_id
    into resolved_project_status, resolved_project_type, source_order_id
    from project_operations.projects p
    where p.tenant_id = row_tenant and p.id = row_project;
  if resolved_project_status is null then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    if resolved_project_status in ('COMPLETED', 'CANCELLED') then
      raise exception 'PROJECT_ALREADY_TERMINAL' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if resolved_project_status in ('COMPLETED', 'CANCELLED') then
    raise exception 'PROJECT_ALREADY_TERMINAL' using errcode = 'P0001';
  end if;
  if new.phase_plan_id is not null and not exists (
    select 1 from project_operations.project_phase_plans
    where tenant_id = new.tenant_id and project_id = new.project_id and id = new.phase_plan_id
  ) then
    raise exception 'PROJECT_TASK_PHASE_INVALID' using errcode = 'P0001';
  end if;
  if new.source_service_order_line_id is not null and (
    resolved_project_type <> 'CLIENT_SERVICE' or not exists (
      select 1 from lab_services.service_order_lines
      where tenant_id = new.tenant_id and service_order_id = source_order_id
        and id = new.source_service_order_line_id
    )
  ) then
    raise exception 'PROJECT_TASK_SOURCE_SCOPE_INVALID' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if old.status in ('DONE', 'CANCELLED') then
      raise exception 'PROJECT_TASK_ALREADY_TERMINAL' using errcode = 'P0001';
    end if;
    if resolved_project_status <> 'ACTIVE' and new.status <> old.status then
      raise exception 'PROJECT_TASK_NOT_STARTABLE' using errcode = 'P0001';
    end if;
    if old.status <> new.status and not (
      (old.status = 'TODO' and new.status in ('IN_PROGRESS', 'DONE', 'CANCELLED'))
      or (old.status = 'IN_PROGRESS' and new.status in ('DONE', 'CANCELLED'))
    ) then
      raise exception 'PROJECT_TASK_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    if new.status in ('IN_PROGRESS', 'DONE') and new.task_kind = 'MILESTONE'
      and new.status = 'IN_PROGRESS' then
      raise exception 'PROJECT_TASK_NOT_STARTABLE' using errcode = 'P0001';
    end if;
    if new.status in ('IN_PROGRESS', 'DONE') and exists (
      select 1 from project_operations.task_dependencies d
      join project_operations.project_tasks predecessor
        on predecessor.tenant_id = d.tenant_id and predecessor.id = d.predecessor_task_id
      where d.tenant_id = new.tenant_id and d.successor_task_id = new.id
        and predecessor.status <> 'DONE'
    ) then
      raise exception 'PROJECT_TASK_DEPENDENCY_UNSATISFIED' using errcode = 'P0001';
    end if;
    if old.status <> 'TODO' and (
      new.project_id <> old.project_id or new.phase_plan_id is distinct from old.phase_plan_id
      or new.source_service_order_line_id is distinct from old.source_service_order_line_id
      or new.task_kind <> old.task_kind or new.title <> old.title
      or new.description is distinct from old.description or new.required <> old.required
    ) then
      raise exception 'PROJECT_TASK_NOT_EDITABLE' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'CANCELLED' and new.required and btrim(coalesce(new.cancellation_reason, '')) = '' then
    raise exception 'PROJECT_TASK_CANCELLATION_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end $$;

commit;

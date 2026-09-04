create schema if not exists project_operations;

revoke all on schema project_operations from public, anon, authenticated;
grant usage on schema project_operations to nox_app_runtime;

create table project_operations.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  project_code text not null,
  project_type text not null check (project_type in ('CLIENT_SERVICE', 'INTERNAL')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text,
  source_service_order_id uuid,
  owner_user_id uuid not null references platform.platform_users(id),
  priority text not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  target_start_date date,
  target_completion_date date,
  hold_reason text,
  cancellation_reason text,
  created_by_user_id uuid not null references platform.platform_users(id),
  activated_by_user_id uuid references platform.platform_users(id),
  held_by_user_id uuid references platform.platform_users(id),
  resumed_by_user_id uuid references platform.platform_users(id),
  completed_by_user_id uuid references platform.platform_users(id),
  cancelled_by_user_id uuid references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  held_at timestamptz,
  resumed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  unique (tenant_id, id),
  constraint project_source_shape check (
    (project_type = 'CLIENT_SERVICE' and source_service_order_id is not null)
    or (project_type = 'INTERNAL' and source_service_order_id is null)
  ),
  constraint project_target_dates check (
    target_start_date is null or target_completion_date is null or target_start_date <= target_completion_date
  )
);
create unique index projects_tenant_code_unique on project_operations.projects(tenant_id, project_code);
create unique index projects_one_client_source_unique on project_operations.projects(tenant_id, source_service_order_id)
  where source_service_order_id is not null;

create table project_operations.project_phase_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  phase_key text not null check (phase_key in ('BRIEF','DESIGN','TRIAL','SENSORY','READINESS','PRODUCTION','QC_RELEASE')),
  phase_order integer not null check (phase_order > 0),
  required boolean not null default false,
  owner_user_id uuid references platform.platform_users(id),
  planned_start_date date,
  planned_due_date date,
  notes text,
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, project_id) references project_operations.projects(tenant_id, id) on delete restrict,
  unique (tenant_id, project_id, phase_key),
  unique (tenant_id, project_id, phase_order),
  constraint phase_dates check (planned_start_date is null or planned_due_date is null or planned_start_date <= planned_due_date)
);

create table project_operations.project_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  phase_plan_id uuid,
  source_service_order_line_id uuid,
  task_kind text not null check (task_kind in ('TASK', 'MILESTONE')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description text,
  status text not null default 'TODO' check (status in ('TODO','IN_PROGRESS','DONE','CANCELLED')),
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  required boolean not null default false,
  assignee_user_id uuid references platform.platform_users(id),
  due_date date,
  cancellation_reason text,
  created_by_user_id uuid not null references platform.platform_users(id),
  started_by_user_id uuid references platform.platform_users(id),
  completed_by_user_id uuid references platform.platform_users(id),
  cancelled_by_user_id uuid references platform.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, project_id) references project_operations.projects(tenant_id, id) on delete restrict,
  foreign key (tenant_id, phase_plan_id) references project_operations.project_phase_plans(tenant_id, id) on delete restrict,
  constraint milestone_not_in_progress check (task_kind <> 'MILESTONE' or status <> 'IN_PROGRESS'),
  constraint required_cancellation_reason check (status <> 'CANCELLED' or not required or cancellation_reason is not null)
);
create index project_tasks_project_status on project_operations.project_tasks(tenant_id, project_id, status);
create index project_tasks_scope_line on project_operations.project_tasks(tenant_id, source_service_order_line_id);

create table project_operations.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  predecessor_task_id uuid not null,
  successor_task_id uuid not null,
  dependency_type text not null default 'FINISH_TO_START' check (dependency_type = 'FINISH_TO_START'),
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, project_id) references project_operations.projects(tenant_id, id) on delete restrict,
  foreign key (tenant_id, predecessor_task_id) references project_operations.project_tasks(tenant_id, id) on delete restrict,
  foreign key (tenant_id, successor_task_id) references project_operations.project_tasks(tenant_id, id) on delete restrict,
  check (predecessor_task_id <> successor_task_id),
  unique (tenant_id, project_id, predecessor_task_id, successor_task_id)
);

create table project_operations.project_artifact_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  phase_plan_id uuid,
  artifact_type text not null check (artifact_type in ('DESIGN_PROJECT','DESIGN_BRIEF','FORMULA_VERSION','TRIAL','SENSORY_EVALUATION','READINESS_ASSESSMENT','PRODUCTION_ORDER','PRODUCTION_BATCH','QC_INSPECTION','BATCH_RELEASE_DECISION')),
  artifact_id uuid not null,
  relationship text not null check (relationship in ('PRIMARY','OUTPUT','EVIDENCE','REFERENCE')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
  created_by_user_id uuid not null references platform.platform_users(id),
  revoked_by_user_id uuid references platform.platform_users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text,
  foreign key (tenant_id, project_id) references project_operations.projects(tenant_id, id) on delete restrict,
  foreign key (tenant_id, phase_plan_id) references project_operations.project_phase_plans(tenant_id, id) on delete restrict,
  constraint link_revoke_shape check ((status = 'ACTIVE' and revoked_at is null and revoked_by_user_id is null) or (status = 'REVOKED' and revoked_at is not null and revoked_by_user_id is not null and revocation_reason is not null))
);
create unique index project_one_active_primary_per_phase on project_operations.project_artifact_links(tenant_id, project_id, phase_plan_id)
  where relationship = 'PRIMARY' and status = 'ACTIVE' and phase_plan_id is not null;

create table project_operations.project_updates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  phase_plan_id uuid,
  task_id uuid,
  update_type text not null check (update_type in ('PROGRESS','BLOCKER','BLOCKER_RESOLVED','DECISION','NOTE')),
  summary text not null check (char_length(btrim(summary)) between 1 and 4000),
  resolves_update_id uuid,
  created_by_user_id uuid not null references platform.platform_users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, project_id) references project_operations.projects(tenant_id, id) on delete restrict,
  foreign key (tenant_id, phase_plan_id) references project_operations.project_phase_plans(tenant_id, id) on delete restrict,
  foreign key (tenant_id, task_id) references project_operations.project_tasks(tenant_id, id) on delete restrict,
  foreign key (tenant_id, resolves_update_id) references project_operations.project_updates(tenant_id, id) on delete restrict,
  constraint resolution_shape check ((update_type = 'BLOCKER_RESOLVED' and resolves_update_id is not null) or (update_type <> 'BLOCKER_RESOLVED' and resolves_update_id is null))
);
create unique index project_blocker_single_resolution on project_operations.project_updates(tenant_id, resolves_update_id)
  where resolves_update_id is not null;
create index project_updates_timeline on project_operations.project_updates(tenant_id, project_id, created_at);

alter table project_operations.projects enable row level security;
alter table project_operations.project_phase_plans enable row level security;
alter table project_operations.project_tasks enable row level security;
alter table project_operations.task_dependencies enable row level security;
alter table project_operations.project_artifact_links enable row level security;
alter table project_operations.project_updates enable row level security;
alter table project_operations.projects force row level security;
alter table project_operations.project_phase_plans force row level security;
alter table project_operations.project_tasks force row level security;
alter table project_operations.task_dependencies force row level security;
alter table project_operations.project_artifact_links force row level security;
alter table project_operations.project_updates force row level security;
revoke all on all tables in schema project_operations from public, anon, authenticated;
-- DRAFT phase-plan replacement and dependency removal are scoped administrative
-- operations.  DELETE remains unavailable to browser roles and is guarded by
-- the project lifecycle triggers below.
grant select, insert, update, delete on all tables in schema project_operations to nox_app_runtime;

-- The database role is server-only; tenant scope is resolved by the G2 request
-- context and enforced by the Project Operations repositories. Browser roles have
-- no grant on this private schema. Force RLS remains a defense against accidental
-- direct access by a differently configured runtime role.
create policy project_operations_runtime_access on project_operations.projects
  for all to nox_app_runtime using (true) with check (true);
create policy project_operations_runtime_access on project_operations.project_phase_plans
  for all to nox_app_runtime using (true) with check (true);
create policy project_operations_runtime_access on project_operations.project_tasks
  for all to nox_app_runtime using (true) with check (true);
create policy project_operations_runtime_access on project_operations.task_dependencies
  for all to nox_app_runtime using (true) with check (true);
create policy project_operations_runtime_access on project_operations.project_artifact_links
  for all to nox_app_runtime using (true) with check (true);
create policy project_operations_runtime_access on project_operations.project_updates
  for all to nox_app_runtime using (true) with check (true);

-- Link identities are historical evidence. They may only transition from ACTIVE to
-- REVOKED with a complete revocation record; no correction is performed in place.
create or replace function project_operations.enforce_artifact_link_history()
returns trigger language plpgsql set search_path = pg_catalog, project_operations as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PROJECT_ARTIFACT_LINK_DELETE_FORBIDDEN' using errcode = 'P0001';
  end if;
  if old.status = 'REVOKED'
    or new.status <> 'REVOKED'
    or new.id <> old.id
    or new.tenant_id <> old.tenant_id
    or new.project_id <> old.project_id
    or new.phase_plan_id is distinct from old.phase_plan_id
    or new.artifact_type <> old.artifact_type
    or new.artifact_id <> old.artifact_id
    or new.relationship <> old.relationship
    or new.created_by_user_id <> old.created_by_user_id
    or new.created_at <> old.created_at
    or new.revoked_by_user_id is null
    or new.revoked_at is null
    or new.revocation_reason is null
  then
    raise exception 'PROJECT_ARTIFACT_LINK_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger project_operations_artifact_link_history
before update or delete on project_operations.project_artifact_links
for each row execute function project_operations.enforce_artifact_link_history();

-- Internal Updates are append-only operational history, including blockers and
-- their explicit resolution records.
create or replace function project_operations.enforce_update_history()
returns trigger language plpgsql set search_path = pg_catalog, project_operations as $$
begin
  raise exception 'PROJECT_UPDATE_APPEND_ONLY' using errcode = 'P0001';
end $$;
create trigger project_operations_update_history
before update or delete on project_operations.project_updates
for each row execute function project_operations.enforce_update_history();

-- The server store remains the orchestration authority, but these guards keep a
-- direct runtime SQL statement from bypassing tenant-safe Project Operations
-- relationships or history/state invariants.
create or replace function project_operations.enforce_project_integrity()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  source_status text;
begin
  if tg_op = 'UPDATE' then
    if old.status in ('COMPLETED', 'CANCELLED') then
      raise exception 'PROJECT_ALREADY_TERMINAL' using errcode = 'P0001';
    end if;
    if new.tenant_id <> old.tenant_id
      or new.project_code <> old.project_code
      or new.project_type <> old.project_type
      or new.source_service_order_id is distinct from old.source_service_order_id then
      raise exception 'PROJECT_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    if old.status = 'DRAFT' and new.status not in ('DRAFT', 'ACTIVE', 'CANCELLED') then
      raise exception 'PROJECT_STATE_INVALID' using errcode = 'P0001';
    elsif old.status = 'ACTIVE' and new.status not in ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED') then
      raise exception 'PROJECT_STATE_INVALID' using errcode = 'P0001';
    elsif old.status = 'ON_HOLD' and new.status not in ('ON_HOLD', 'ACTIVE', 'CANCELLED') then
      raise exception 'PROJECT_STATE_INVALID' using errcode = 'P0001';
    end if;
    if new.status = 'ON_HOLD' and btrim(coalesce(new.hold_reason, '')) = '' then
      raise exception 'PROJECT_HOLD_REASON_REQUIRED' using errcode = 'P0001';
    end if;
    if new.status = 'CANCELLED' and old.status <> 'DRAFT'
      and btrim(coalesce(new.cancellation_reason, '')) = '' then
      raise exception 'PROJECT_CANCELLATION_REASON_REQUIRED' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' and new.project_type = 'CLIENT_SERVICE' then
    select status into source_status from lab_services.service_orders
      where tenant_id = new.tenant_id and id = new.source_service_order_id;
    if source_status not in ('CONFIRMED', 'IN_PROGRESS') then
      raise exception 'PROJECT_SOURCE_SERVICE_ORDER_INVALID' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger project_operations_project_guard
before insert or update on project_operations.projects
for each row execute function project_operations.enforce_project_integrity();

create or replace function project_operations.enforce_phase_plan_integrity()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  project_status text;
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
  select status into project_status from project_operations.projects
    where tenant_id = row_tenant and id = row_project;
  if project_status is null then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    if project_status <> 'DRAFT' then
      raise exception 'PROJECT_PHASE_IMMUTABLE' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if project_status in ('COMPLETED', 'CANCELLED') then
    raise exception 'PROJECT_ALREADY_TERMINAL' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and project_status <> 'DRAFT' and (
    new.tenant_id <> old.tenant_id or new.project_id <> old.project_id
    or new.phase_key <> old.phase_key or new.phase_order <> old.phase_order
    or new.required <> old.required
  ) then
    raise exception 'PROJECT_PHASE_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger project_operations_phase_plan_guard
before insert or update or delete on project_operations.project_phase_plans
for each row execute function project_operations.enforce_phase_plan_integrity();

create or replace function project_operations.enforce_task_integrity()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  project_status text;
  project_type text;
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
  select status, project_type, source_service_order_id
    into project_status, project_type, source_order_id
    from project_operations.projects
    where tenant_id = row_tenant and id = row_project;
  if project_status is null then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    if project_status in ('COMPLETED', 'CANCELLED') then
      raise exception 'PROJECT_ALREADY_TERMINAL' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if project_status in ('COMPLETED', 'CANCELLED') then
    raise exception 'PROJECT_ALREADY_TERMINAL' using errcode = 'P0001';
  end if;
  if new.phase_plan_id is not null and not exists (
    select 1 from project_operations.project_phase_plans
    where tenant_id = new.tenant_id and project_id = new.project_id and id = new.phase_plan_id
  ) then
    raise exception 'PROJECT_TASK_PHASE_INVALID' using errcode = 'P0001';
  end if;
  if new.source_service_order_line_id is not null and (
    project_type <> 'CLIENT_SERVICE' or not exists (
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
    if project_status <> 'ACTIVE' and new.status <> old.status then
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
create trigger project_operations_task_guard
before insert or update or delete on project_operations.project_tasks
for each row execute function project_operations.enforce_task_integrity();

create or replace function project_operations.enforce_dependency_integrity()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  project_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'PROJECT_DEPENDENCY_IMMUTABLE' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    select status into project_status from project_operations.projects
      where tenant_id = old.tenant_id and id = old.project_id;
    if project_status not in ('DRAFT', 'ACTIVE') then
      raise exception 'PROJECT_DEPENDENCY_IMMUTABLE' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if not exists (
    select 1 from project_operations.project_tasks
    where tenant_id = new.tenant_id and project_id = new.project_id and id = new.predecessor_task_id
  ) or not exists (
    select 1 from project_operations.project_tasks
    where tenant_id = new.tenant_id and project_id = new.project_id and id = new.successor_task_id
  ) then
    raise exception 'PROJECT_DEPENDENCY_CROSS_PROJECT' using errcode = 'P0001';
  end if;
  if exists (
    with recursive path(id) as (
      select successor_task_id from project_operations.task_dependencies
        where tenant_id = new.tenant_id and predecessor_task_id = new.successor_task_id
      union
      select d.successor_task_id from project_operations.task_dependencies d
        join path p on p.id = d.predecessor_task_id
        where d.tenant_id = new.tenant_id
    ) select 1 from path where id = new.predecessor_task_id
  ) then
    raise exception 'PROJECT_DEPENDENCY_CYCLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger project_operations_dependency_guard
before insert or update or delete on project_operations.task_dependencies
for each row execute function project_operations.enforce_dependency_integrity();

create or replace function project_operations.enforce_artifact_link_insert()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if new.phase_plan_id is not null and not exists (
    select 1 from project_operations.project_phase_plans
    where tenant_id = new.tenant_id and project_id = new.project_id and id = new.phase_plan_id
  ) then
    raise exception 'PROJECT_ARTIFACT_PHASE_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger project_operations_artifact_link_insert_guard
before insert on project_operations.project_artifact_links
for each row execute function project_operations.enforce_artifact_link_insert();

create or replace function project_operations.enforce_update_insert()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if new.phase_plan_id is not null and not exists (
    select 1 from project_operations.project_phase_plans
    where tenant_id = new.tenant_id and project_id = new.project_id and id = new.phase_plan_id
  ) then
    raise exception 'PROJECT_PHASE_INVALID' using errcode = 'P0001';
  end if;
  if new.task_id is not null and not exists (
    select 1 from project_operations.project_tasks
    where tenant_id = new.tenant_id and project_id = new.project_id and id = new.task_id
  ) then
    raise exception 'PROJECT_TASK_NOT_FOUND' using errcode = 'P0001';
  end if;
  if new.update_type = 'BLOCKER_RESOLVED' and not exists (
    select 1 from project_operations.project_updates
    where tenant_id = new.tenant_id and project_id = new.project_id
      and id = new.resolves_update_id and update_type = 'BLOCKER'
  ) then
    raise exception 'PROJECT_BLOCKER_NOT_FOUND' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger project_operations_update_insert_guard
before insert on project_operations.project_updates
for each row execute function project_operations.enforce_update_insert();

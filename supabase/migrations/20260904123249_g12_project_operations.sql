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
grant select, insert, update on all tables in schema project_operations to nox_app_runtime;

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

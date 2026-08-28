-- Defense in depth for the GLOBAL/SYSTEM-only technical workflow probe.
-- Role grants remain the primary database privilege boundary; these policies ensure
-- the table also fails closed through PostgreSQL row security.

alter table nox_foundation.workflow_probe_runs enable row level security;
alter table nox_foundation.workflow_probe_runs force row level security;

create policy foundation_probe_app_read
  on nox_foundation.workflow_probe_runs
  for select
  to nox_app_runtime
  using (true);

create policy foundation_probe_workflow_read
  on nox_foundation.workflow_probe_runs
  for select
  to nox_workflow_runtime
  using (true);

create policy foundation_probe_workflow_insert
  on nox_foundation.workflow_probe_runs
  for insert
  to nox_workflow_runtime
  with check (state = 'COMPLETED' and delivery_count >= 1);

create policy foundation_probe_workflow_update
  on nox_foundation.workflow_probe_runs
  for update
  to nox_workflow_runtime
  using (true)
  with check (state = 'COMPLETED' and delivery_count >= 1);

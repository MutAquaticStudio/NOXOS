begin;

select plan(15);

select ok(
  exists (select 1 from pg_catalog.pg_roles where rolname = 'nox_app_runtime'),
  'limited application runtime role exists'
);
select ok(
  exists (select 1 from pg_catalog.pg_roles where rolname = 'nox_workflow_runtime'),
  'limited workflow runtime role exists'
);
select ok(
  not (select rolsuper from pg_catalog.pg_roles where rolname = 'nox_app_runtime'),
  'application runtime is not superuser'
);
select ok(
  not (select rolcreaterole from pg_catalog.pg_roles where rolname = 'nox_app_runtime'),
  'application runtime cannot create roles'
);
select ok(
  not (select rolcreatedb from pg_catalog.pg_roles where rolname = 'nox_app_runtime'),
  'application runtime cannot create databases'
);
select ok(
  not (select rolbypassrls from pg_catalog.pg_roles where rolname = 'nox_app_runtime'),
  'application runtime cannot bypass row security'
);
select ok(
  not (select rolsuper from pg_catalog.pg_roles where rolname = 'nox_workflow_runtime'),
  'workflow runtime is not superuser'
);
select ok(
  not (select rolcreaterole from pg_catalog.pg_roles where rolname = 'nox_workflow_runtime'),
  'workflow runtime cannot create roles'
);
select ok(
  not (select rolcreatedb from pg_catalog.pg_roles where rolname = 'nox_workflow_runtime'),
  'workflow runtime cannot create databases'
);
select ok(
  not (select rolbypassrls from pg_catalog.pg_roles where rolname = 'nox_workflow_runtime'),
  'workflow runtime cannot bypass row security'
);
select ok(
  has_table_privilege('nox_app_runtime', 'nox_foundation.workflow_probe_runs', 'select')
  and not has_table_privilege('nox_app_runtime', 'nox_foundation.workflow_probe_runs', 'insert')
  and not has_table_privilege('nox_app_runtime', 'nox_foundation.workflow_probe_runs', 'update'),
  'application runtime can observe but cannot mutate workflow completion'
);
select ok(
  has_table_privilege('nox_workflow_runtime', 'nox_foundation.workflow_probe_runs', 'select,insert,update')
  and not has_table_privilege('nox_workflow_runtime', 'nox_foundation.workflow_probe_runs', 'delete'),
  'workflow runtime has only the diagnostic completion privileges it needs'
);
select ok(
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'nox_foundation'
      and table_name = 'workflow_probe_runs'
  ),
  'foundation migration creates only the technical durable-workflow probe surface'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'nox_foundation.workflow_probe_runs'::regclass),
  'technical workflow probe enforces row security'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_policy
   where polrelid = 'nox_foundation.workflow_probe_runs'::regclass),
  4,
  'row-security policies exist only for the two limited runtime roles'
);

select * from finish();
rollback;

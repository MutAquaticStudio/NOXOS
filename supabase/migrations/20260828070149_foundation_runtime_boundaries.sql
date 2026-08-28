-- Gate 1 technical baseline only: limited runtime roles and one diagnostic
-- completion record used to verify durable execution. No business schema lives here.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'nox_app_runtime') then
    execute 'create role nox_app_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'nox_workflow_runtime') then
    execute 'create role nox_workflow_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls';
  end if;
end
$roles$;

-- The connected migration administrator has CREATEROLE but is intentionally not a
-- superuser. Defaults on CREATE establish NOSUPERUSER/NOREPLICATION/NOBYPASSRLS;
-- ordinary reconciliation can safely enforce only attributes it is allowed to alter.
alter role nox_app_runtime nocreatedb nocreaterole noinherit;
alter role nox_workflow_runtime nocreatedb nocreaterole noinherit;

alter role nox_app_runtime set statement_timeout = '8s';
alter role nox_app_runtime set idle_in_transaction_session_timeout = '8s';
alter role nox_workflow_runtime set statement_timeout = '30s';
alter role nox_workflow_runtime set idle_in_transaction_session_timeout = '30s';

grant connect on database postgres to nox_app_runtime, nox_workflow_runtime;

create schema if not exists nox_foundation authorization postgres;
revoke all on schema nox_foundation from public;
grant usage on schema nox_foundation to nox_app_runtime, nox_workflow_runtime;

create table if not exists nox_foundation.workflow_probe_runs (
  workflow_id text primary key,
  correlation_id text not null,
  idempotency_key text not null unique,
  state text not null check (state = 'COMPLETED'),
  delivery_count integer not null check (delivery_count >= 1),
  completed_at timestamptz not null default now(),
  constraint workflow_probe_id_format check (workflow_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  constraint workflow_probe_correlation_format check (correlation_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  constraint workflow_probe_idempotency_format check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$')
);

alter table nox_foundation.workflow_probe_runs owner to postgres;
revoke all on nox_foundation.workflow_probe_runs from public;
revoke all on nox_foundation.workflow_probe_runs from anon, authenticated;
grant select on nox_foundation.workflow_probe_runs to nox_app_runtime;
grant select, insert, update on nox_foundation.workflow_probe_runs to nox_workflow_runtime;

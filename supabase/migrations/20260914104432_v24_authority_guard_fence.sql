-- v2.4 I03/I04: technical serialization only, not a business authorization grant.
-- Additive on the inspected existing staging baseline; no existing rows are copied.
create table nox_foundation.guard_fence (
  scope text not null check (scope in ('TENANT', 'PLATFORM')),
  tenant_id uuid,
  tenant_key text generated always as (coalesce(tenant_id::text, '')) stored,
  owner_gate text not null check (owner_gate ~ '^G([0-9]|1[0-5])$'),
  object_type text not null check (object_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  object_id text not null check (length(object_id) between 1 and 128),
  epoch bigint not null default 1 check (epoch > 0),
  primary key (scope, tenant_key, owner_gate, object_type, object_id),
  check ((scope = 'TENANT' and tenant_id is not null) or
         (scope = 'PLATFORM' and tenant_id is null))
);

alter table nox_foundation.guard_fence enable row level security;
alter table nox_foundation.guard_fence force row level security;
revoke all on nox_foundation.guard_fence from public, anon, authenticated, nox_workflow_runtime;
grant select, insert on nox_foundation.guard_fence to nox_app_runtime;
grant update (epoch) on nox_foundation.guard_fence to nox_app_runtime;

-- These transaction-local settings come only from the server's verified context.
-- No SQL/RPC endpoint may let a caller set them. G2 session and owner checks remain mandatory.
create policy guard_fence_runtime_scope on nox_foundation.guard_fence
  for all to nox_app_runtime
  using (
    nullif(current_setting('nox.actor_id', true), '') is not null
    and scope = current_setting('nox.scope', true)
    and tenant_id is not distinct from nullif(current_setting('nox.tenant_id', true), '')::uuid
  )
  with check (
    nullif(current_setting('nox.actor_id', true), '') is not null
    and scope = current_setting('nox.scope', true)
    and tenant_id is not distinct from nullif(current_setting('nox.tenant_id', true), '')::uuid
  );

create function nox_foundation.guard_fence_epoch_step()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if row(new.scope, new.tenant_id, new.owner_gate, new.object_type, new.object_id)
     is distinct from row(old.scope, old.tenant_id, old.owner_gate, old.object_type, old.object_id)
     or new.epoch <> old.epoch + 1 then
    raise exception 'Guard identity is immutable and epoch must advance once' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function nox_foundation.guard_fence_epoch_step() from public, anon, authenticated;
create trigger guard_fence_epoch_step before update on nox_foundation.guard_fence
  for each row execute function nox_foundation.guard_fence_epoch_step();

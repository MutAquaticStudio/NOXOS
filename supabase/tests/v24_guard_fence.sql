-- Staging-only synthetic scope test. Every fixture is rolled back.
begin;
set local role nox_app_runtime;
select set_config('nox.actor_id', 'v24-guard-test-actor', true);
select set_config('nox.scope', 'TENANT', true);
select set_config('nox.tenant_id', '11111111-1111-4111-8111-111111111111', true);
insert into nox_foundation.guard_fence(scope,tenant_id,owner_gate,object_type,object_id)
values ('TENANT','11111111-1111-4111-8111-111111111111','G2','session','v24-rollback-fixture');
do $$
begin
  if (select count(*) from nox_foundation.guard_fence where object_id='v24-rollback-fixture') <> 1 then
    raise exception 'own scope read failed';
  end if;
  begin
    insert into nox_foundation.guard_fence(scope,tenant_id,owner_gate,object_type,object_id)
    values ('TENANT','22222222-2222-4222-8222-222222222222','G2','session','v24-rollback-fixture');
    raise exception 'cross tenant insert unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update nox_foundation.guard_fence set epoch=epoch+2 where object_id='v24-rollback-fixture';
    raise exception 'epoch skip unexpectedly allowed';
  exception when check_violation then null;
  end;
end;
$$;
update nox_foundation.guard_fence set epoch=epoch+1 where object_id='v24-rollback-fixture';
select set_config('nox.tenant_id', '22222222-2222-4222-8222-222222222222', true);
do $$
begin
  if exists(select 1 from nox_foundation.guard_fence where object_id='v24-rollback-fixture') then
    raise exception 'cross tenant read unexpectedly allowed';
  end if;
end;
$$;
select set_config('nox.actor_id', '', true);
do $$
begin
  if exists(select 1 from nox_foundation.guard_fence) then
    raise exception 'missing actor unexpectedly allowed';
  end if;
end;
$$;
rollback;
select 'PASS' as guard_rls_and_epoch_test,
  not exists(select 1 from nox_foundation.guard_fence where object_id='v24-rollback-fixture') as rollback_verified;

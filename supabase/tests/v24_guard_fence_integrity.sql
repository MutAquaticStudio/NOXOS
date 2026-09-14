-- Administrator constraint/rollback test, deliberately NOT an RLS/runtime test.
begin;
insert into nox_foundation.guard_fence(scope,tenant_id,owner_gate,object_type,object_id)
values ('TENANT','11111111-1111-4111-8111-111111111111','G2','session','v24-constraint-fixture'),
       ('TENANT','22222222-2222-4222-8222-222222222222','G2','session','v24-constraint-fixture');
do $$
begin
  begin
    insert into nox_foundation.guard_fence(scope,tenant_id,owner_gate,object_type,object_id)
    values ('TENANT','11111111-1111-4111-8111-111111111111','G2','session','v24-constraint-fixture');
    raise exception 'Duplicate authority key was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into nox_foundation.guard_fence(scope,tenant_id,owner_gate,object_type,object_id)
    values ('TENANT',null,'G2','session','v24-constraint-fixture');
    raise exception 'Missing tenant was accepted';
  exception when check_violation then null;
  end;
  begin
    update nox_foundation.guard_fence set epoch=epoch+2 where object_id='v24-constraint-fixture';
    raise exception 'Epoch skip was accepted';
  exception when check_violation then null;
  end;
  begin
    update nox_foundation.guard_fence set object_id='rewritten' where object_id='v24-constraint-fixture';
    raise exception 'Authority identity rewrite was accepted';
  exception when check_violation then null;
  end;
end;
$$;
update nox_foundation.guard_fence set epoch=epoch+1 where object_id='v24-constraint-fixture';
do $$
begin
  if (select count(*) from nox_foundation.guard_fence where object_id='v24-constraint-fixture' and epoch=2) <> 2 then
    raise exception 'Unit epoch increment failed';
  end if;
end;
$$;
rollback;
select 'PASS' as constraint_test,
  not exists(select 1 from nox_foundation.guard_fence where object_id='v24-constraint-fixture') as rollback_verified;

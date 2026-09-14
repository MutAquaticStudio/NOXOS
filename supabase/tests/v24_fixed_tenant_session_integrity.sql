begin;
do $$
declare
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid();
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  binding uuid := gen_random_uuid(); sid uuid := gen_random_uuid();
  op uuid := gen_random_uuid(); host text := 'v24-'||ta::text||'.example.test';
  digest text := replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
begin
  insert into platform.tenants(id,name,slug,status) values
    (ta,'Synthetic v24 A','v24-'||ta::text,'ACTIVE'),(tb,'Synthetic v24 B','v24-'||tb::text,'ACTIVE');
  insert into platform.tenant_users(id,tenant_id,state) values (ua,ta,'ACTIVE'),(ub,tb,'ACTIVE');
  insert into platform.auth_principal_binding(id,tenant_id,actor_id,realm,provider_key,issuer,provider_subject,state)
    values(binding,ta,ua,'TENANT','supabase','https://uyfddpmbszjkhdkqvncz.supabase.co/auth/v1',ua::text,'ACTIVE');
  begin
    insert into platform.auth_principal_binding(tenant_id,actor_id,realm,provider_key,issuer,provider_subject,state)
      values(ta,ub,'TENANT','supabase','https://uyfddpmbszjkhdkqvncz.supabase.co/auth/v1',ub::text,'ACTIVE');
    raise exception 'TEST_FAILED_CROSS_TENANT_BINDING';
  exception when foreign_key_violation then null; end;
  begin
    insert into platform.auth_principal_binding(tenant_id,actor_id,realm,provider_key,issuer,provider_subject,state)
      values(ta,ua,'TENANT','supabase','https://uyfddpmbszjkhdkqvncz.supabase.co/auth/v1',ua::text,'ACTIVE');
    raise exception 'TEST_FAILED_DUPLICATE_BINDING';
  exception when unique_violation then null; end;
  begin
    update platform.tenant_users set tenant_id=tb,entity_version=2 where id=ua;
    raise exception 'TEST_FAILED_ACTOR_REASSIGNMENT';
  exception when check_violation then null; end;
  insert into platform.tenant_host_registry(host_ascii,tenant_id,route_kind,state,routing_version,policy_version)
    values(host,ta,'TENANT_CANONICAL','ACTIVE',1,'test');
  begin
    update platform.tenant_host_registry set tenant_id=tb,entity_version=2 where host_ascii=host;
    raise exception 'TEST_FAILED_HOST_REASSIGNMENT';
  exception when check_violation then null; end;
  insert into platform.application_session(id,auth_operation_id,binding_id,actor_id,tenant_id,actor_kind,realm,mode,
    assurance,environment,secret_digest,token_digest_policy,token_digest_key_version,issued_host,routing_version_at_issue,
    credential_epoch,authorization_epoch,issued_at,last_authoritative_activity_at,idle_expires_at,absolute_expires_at,state)
    values(sid,op,binding,ua,ta,'TENANT_USER','TENANT','NORMAL','A1','staging',digest,
      'HMAC-SHA3-256-KEYED-V1','test',host,1,1,1,now(),now(),now()+interval '10 minutes',now()+interval '1 hour','ACTIVE');
  begin
    update platform.application_session set actor_id=ub,entity_version=2 where id=sid;
    raise exception 'TEST_FAILED_SESSION_REASSIGNMENT';
  exception when check_violation then null; end;
  update platform.application_session set state='REVOKED',entity_version=2 where id=sid;
  begin
    update platform.application_session set state='ACTIVE',entity_version=3 where id=sid;
    raise exception 'TEST_FAILED_SESSION_RESURRECTION';
  exception when check_violation then null; end;
  if has_table_privilege('nox_app_runtime','platform.application_session','INSERT')
     or has_table_privilege('anon','platform.application_session','SELECT')
     or has_table_privilege('authenticated','platform.tenant_users','SELECT') then
    raise exception 'TEST_FAILED_GRANTS';
  end if;
end $$;
rollback;
select 'PASS' as admin_integrity_rollback_only;

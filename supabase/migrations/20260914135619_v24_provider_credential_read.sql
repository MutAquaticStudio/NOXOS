-- Private provider adapter: read current native credential/session eligibility
-- without granting application runtime SELECT on auth.users/auth.sessions.
-- SECURITY DEFINER is intentional only for this boolean-like provider read.
-- No credential fields, native tokens, email, role or metadata are returned.
create function platform.read_auth_flow_credential_state(flow_ref uuid) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare
  flow_row record;
  native_user record;
  native_session record;
  expected_issuer text;
begin
  -- This is the opaque server-session lane, not a JWT/Data API RPC.
  if auth.uid() is not null then return 'UNKNOWN'; end if;
  expected_issuer := case current_setting('nox.environment',true)
    when 'staging' then 'https://uyfddpmbszjkhdkqvncz.supabase.co/auth/v1'
    when 'production' then 'https://soioshmcdwxhlgrjzkoc.supabase.co/auth/v1'
    else null end;
  if expected_issuer is null then return 'UNKNOWN'; end if;
  select f.verified_subject_ref,f.provider_session_ref into flow_row
    from platform.auth_flow f
    join platform.tenant_host_registry h on h.host_ascii=f.issued_host and h.tenant_id=f.tenant_id
    join platform.tenants t on t.id=f.tenant_id
    join platform.auth_principal_binding b on b.tenant_id=f.tenant_id
      and b.provider_key='supabase' and b.realm='TENANT' and b.issuer=f.verified_issuer
      and b.provider_subject=f.verified_subject_ref and b.state='ACTIVE'
    join platform.tenant_users u on u.id=b.actor_id and u.tenant_id=b.tenant_id and u.state='ACTIVE'
    where f.id=flow_ref and f.realm='TENANT' and f.purpose='TENANT_LOGIN'
      and f.state in ('PRIMARY_VERIFIED','AUTHENTICATED','STEP_UP_REQUIRED')
      and f.expires_at>clock_timestamp() and f.environment=current_setting('nox.environment',true)
      and f.issued_host=current_setting('nox.request_host',true)
      and f.tenant_id::text=current_setting('nox.tenant_id',true)
      and f.flow_secret_digest=current_setting('nox.auth_flow_digest',true)
      and b.actor_id::text=current_setting('nox.actor_id',true)
      and f.verified_issuer=expected_issuer and f.achieved_assurance='A1'
      and h.state='ACTIVE' and h.route_kind='TENANT_CANONICAL'
      and h.routing_version=f.routing_version and t.status='ACTIVE';
  if not found then return 'UNKNOWN'; end if;
  -- Lock current provider rows until the caller's issuance transaction finishes.
  -- Revocation committed first is observed; revocation after this commit wins on
  -- subsequent credential checks. Do not turn this read into provider mutation.
  select id,deleted_at,banned_until,email_confirmed_at into native_user from auth.users
    where id::text=flow_row.verified_subject_ref for share;
  if not found then return 'REVOKED'; end if;
  if native_user.deleted_at is not null or native_user.email_confirmed_at is null
    or native_user.banned_until>clock_timestamp() then return 'REVOKED'; end if;
  select id,not_after into native_session from auth.sessions
    where id=flow_row.provider_session_ref and user_id=native_user.id for share;
  if not found then return 'REVOKED'; end if;
  if native_session.not_after<=clock_timestamp() then return 'REVOKED'; end if;
  return 'CURRENT';
end $$;
revoke all on function platform.read_auth_flow_credential_state(uuid)
  from public,anon,authenticated,nox_workflow_runtime;
grant execute on function platform.read_auth_flow_credential_state(uuid) to nox_app_runtime;

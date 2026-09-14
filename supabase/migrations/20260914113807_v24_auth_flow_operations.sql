-- G2 password-flow operation identity; no legacy identity conversion.
-- Secrets are keyed digests only. Provider attempts are claimed before network IO.
create table platform.auth_flow (
  id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  realm text not null check (realm='TENANT'),
  environment text not null check (environment in ('staging','production')),
  issued_host text not null,
  routing_version integer not null check (routing_version>0),
  purpose text not null check (purpose='TENANT_LOGIN'),
  client_flow_nonce_digest text not null check (client_flow_nonce_digest ~ '^[a-f0-9]{64}$'),
  flow_secret_digest text not null unique check (flow_secret_digest ~ '^[a-f0-9]{64}$'),
  identifier_correlation_digest text not null check (identifier_correlation_digest ~ '^[a-f0-9]{64}$'),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  digest_policy text not null check (digest_policy='FIPS202-SHA3-256-DOMAIN-SEPARATED-V1'),
  token_digest_key_version text not null check (token_digest_key_version ~ '^[A-Za-z0-9._-]{1,128}$'),
  state text not null check (state in ('INITIATED','PENDING_RECONCILIATION','PRIMARY_VERIFIED','STEP_UP_REQUIRED','AUTHENTICATED','SESSION_ISSUED','FAILED_GENERIC','EXPIRED','CANCELLED')),
  provider_operation_id uuid unique,
  verified_issuer text,
  verified_subject_ref text,
  provider_session_ref uuid,
  achieved_assurance text check (achieved_assurance in ('A1','A2','PHISHING_RESISTANT')),
  required_assurance text not null check (required_assurance in ('A1','A2','PHISHING_RESISTANT')),
  policy_version text not null check (length(policy_version) between 1 and 128),
  safe_return_path text not null check (safe_return_path ~ '^/[^/\\?#]*$'),
  issued_session_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  terminal_at timestamptz,
  entity_version bigint not null default 1 check (entity_version>0),
  foreign key (issued_host,tenant_id) references platform.tenant_host_registry(host_ascii,tenant_id),
  unique (realm,issued_host,client_flow_nonce_digest,purpose),
  check (expires_at>created_at and expires_at<=created_at+interval '900 seconds'),
  check ((state in ('SESSION_ISSUED','FAILED_GENERIC','EXPIRED','CANCELLED')) = (terminal_at is not null)),
  check ((state='SESSION_ISSUED') = (issued_session_id is not null)),
  check (state not in ('PRIMARY_VERIFIED','AUTHENTICATED','SESSION_ISSUED') or
    (verified_issuer is not null and verified_subject_ref is not null and provider_session_ref is not null and achieved_assurance is not null)),
  check (state='INITIATED' or provider_operation_id is not null or state in ('EXPIRED','CANCELLED','FAILED_GENERIC'))
);
alter table platform.application_session add constraint application_session_flow_result_identity
  unique (id,tenant_id,auth_operation_id);
alter table platform.auth_flow add constraint auth_flow_exact_session_result
  foreign key (issued_session_id,tenant_id,id)
  references platform.application_session(id,tenant_id,auth_operation_id);
create index auth_flow_expiry on platform.auth_flow(expires_at) where terminal_at is null;

alter table platform.auth_flow enable row level security;
alter table platform.auth_flow force row level security;
revoke all on platform.auth_flow from public,anon,authenticated,nox_workflow_runtime,nox_app_runtime;
grant select,insert on platform.auth_flow to nox_app_runtime;
grant update(state,provider_operation_id,verified_issuer,verified_subject_ref,provider_session_ref,
  achieved_assurance,issued_session_id,terminal_at,entity_version) on platform.auth_flow to nox_app_runtime;
create policy auth_flow_bound_access on platform.auth_flow to nox_app_runtime
  using (issued_host=current_setting('nox.request_host',true)
    and environment=current_setting('nox.environment',true)
    and tenant_id::text=current_setting('nox.tenant_id',true)
    and flow_secret_digest=current_setting('nox.auth_flow_digest',true))
  with check (issued_host=current_setting('nox.request_host',true)
    and environment=current_setting('nox.environment',true)
    and tenant_id::text=current_setting('nox.tenant_id',true)
    and flow_secret_digest=current_setting('nox.auth_flow_digest',true));

create function platform.preserve_auth_flow_operation() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if old.terminal_at is not null then
    raise exception 'AUTH_FLOW_TERMINAL' using errcode='23514';
  end if;
  if (to_jsonb(new)-array['state','provider_operation_id','verified_issuer','verified_subject_ref','provider_session_ref','achieved_assurance','issued_session_id','terminal_at','entity_version'])
    is distinct from (to_jsonb(old)-array['state','provider_operation_id','verified_issuer','verified_subject_ref','provider_session_ref','achieved_assurance','issued_session_id','terminal_at','entity_version'])
    or new.entity_version<>old.entity_version+1 then
    raise exception 'AUTH_FLOW_IDENTITY_IMMUTABLE' using errcode='23514';
  end if;
  if old.provider_operation_id is not null and new.provider_operation_id is distinct from old.provider_operation_id then
    raise exception 'AUTH_PROVIDER_OPERATION_IMMUTABLE' using errcode='23514';
  end if;
  if old.verified_subject_ref is not null and
    (new.verified_issuer,new.verified_subject_ref,new.provider_session_ref)
      is distinct from (old.verified_issuer,old.verified_subject_ref,old.provider_session_ref) then
    raise exception 'AUTH_VERIFIED_IDENTITY_IMMUTABLE' using errcode='23514';
  end if;
  if old.achieved_assurance is not null and new.achieved_assurance is distinct from old.achieved_assurance
    and not (old.state='STEP_UP_REQUIRED' and new.state='AUTHENTICATED'
      and ((old.achieved_assurance='A1' and new.achieved_assurance in ('A2','PHISHING_RESISTANT'))
        or (old.achieved_assurance='A2' and new.achieved_assurance='PHISHING_RESISTANT'))) then
    raise exception 'ASSURANCE_TRANSITION_DENIED' using errcode='23514';
  end if;
  if not (
    (old.state='INITIATED' and new.state in ('PENDING_RECONCILIATION','FAILED_GENERIC','EXPIRED','CANCELLED')) or
    (old.state='PENDING_RECONCILIATION' and new.state in ('PRIMARY_VERIFIED','FAILED_GENERIC','EXPIRED','CANCELLED')) or
    (old.state='PRIMARY_VERIFIED' and new.state in ('AUTHENTICATED','STEP_UP_REQUIRED','FAILED_GENERIC','EXPIRED','CANCELLED')) or
    (old.state='STEP_UP_REQUIRED' and new.state in ('AUTHENTICATED','FAILED_GENERIC','EXPIRED','CANCELLED')) or
    (old.state='AUTHENTICATED' and new.state in ('SESSION_ISSUED','FAILED_GENERIC','EXPIRED','CANCELLED'))
  ) then raise exception 'AUTH_FLOW_TRANSITION_DENIED' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function platform.preserve_auth_flow_operation() from public,anon,authenticated;
create trigger auth_flow_operation_integrity before update on platform.auth_flow
  for each row execute function platform.preserve_auth_flow_operation();

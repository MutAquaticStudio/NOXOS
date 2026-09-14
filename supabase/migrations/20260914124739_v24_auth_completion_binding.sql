-- Complete request identity is distinct from the immutable AUTH-001 start digest.
-- Existing claimed flows need explicit provenance, never fabricated digest backfills.
do $$ begin
  if exists(select 1 from platform.auth_flow where provider_operation_id is not null) then
    raise exception 'AUTH_COMPLETION_BACKFILL_REVIEW_REQUIRED';
  end if;
end $$;
alter table platform.auth_flow
  add column complete_operation_digest text check (complete_operation_digest ~ '^[a-f0-9]{64}$'),
  add column complete_request_digest text check (complete_request_digest ~ '^[a-f0-9]{64}$'),
  add constraint auth_complete_digest_pair check (
    (complete_operation_digest is null) = (complete_request_digest is null)
    and (provider_operation_id is null) = (complete_operation_digest is null));
grant update(complete_operation_digest,complete_request_digest) on platform.auth_flow to nox_app_runtime;
create or replace function platform.preserve_auth_flow_operation() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if old.terminal_at is not null then
    raise exception 'AUTH_FLOW_TERMINAL' using errcode='23514';
  end if;
  if (to_jsonb(new)-array['state','complete_operation_digest','complete_request_digest','provider_operation_id','verified_issuer','verified_subject_ref','provider_session_ref','achieved_assurance','issued_session_id','terminal_at','entity_version'])
    is distinct from (to_jsonb(old)-array['state','complete_operation_digest','complete_request_digest','provider_operation_id','verified_issuer','verified_subject_ref','provider_session_ref','achieved_assurance','issued_session_id','terminal_at','entity_version'])
    or new.entity_version<>old.entity_version+1 then
    raise exception 'AUTH_FLOW_IDENTITY_IMMUTABLE' using errcode='23514';
  end if;
  if old.complete_operation_digest is not null and
    (new.complete_operation_digest,new.complete_request_digest)
      is distinct from (old.complete_operation_digest,old.complete_request_digest) then
    raise exception 'AUTH_COMPLETION_IDENTITY_IMMUTABLE' using errcode='23514';
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

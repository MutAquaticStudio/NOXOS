-- I05A.2 / S03.2: G1 technical abuse state, not a business account or session.
-- Only keyed, purpose-separated digests reach this table. No identifier/IP/secret.
create table nox_foundation.auth_rate_bucket (
  environment text not null check (environment in ('staging','production')),
  realm text not null check (realm in ('TENANT','PLATFORM')),
  policy_ref text not null check (policy_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  key_version text not null check (key_version ~ '^[A-Za-z0-9._-]{1,128}$'),
  dimension text not null check (dimension in ('IDENTIFIER','NETWORK','FLOW','SUBJECT')),
  subject_digest text not null check (subject_digest ~ '^[a-f0-9]{64}$'),
  token_digest_policy text not null default 'HMAC-SHA3-256-KEYED-V1'
    check (token_digest_policy = 'HMAC-SHA3-256-KEYED-V1'),
  window_seconds integer not null check (window_seconds between 1 and 3600),
  attempt_limit integer not null check (attempt_limit between 1 and 1000000),
  attempts integer not null check (attempts between 1 and 1000001),
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (environment,realm,policy_ref,key_version,dimension,subject_digest),
  check (expires_at = window_started_at + window_seconds * interval '1 second'),
  check (attempts <= attempt_limit + 1)
);
create index auth_rate_bucket_expiry on nox_foundation.auth_rate_bucket(expires_at);
alter table nox_foundation.auth_rate_bucket enable row level security;
alter table nox_foundation.auth_rate_bucket force row level security;
revoke all on nox_foundation.auth_rate_bucket from public,anon,authenticated,nox_workflow_runtime;
grant select,insert on nox_foundation.auth_rate_bucket to nox_app_runtime;
grant update(attempts,window_started_at,expires_at) on nox_foundation.auth_rate_bucket to nox_app_runtime;
grant delete on nox_foundation.auth_rate_bucket to nox_app_runtime;

-- Context is set inside the server transaction. Browser inputs never set these.
-- Anonymous technical state is realm/environment scoped, not an actor lookup.
create policy auth_rate_read on nox_foundation.auth_rate_bucket for select to nox_app_runtime
using (environment = current_setting('nox.environment',true)
  and realm = current_setting('nox.auth_rate_realm',true)
  and (subject_digest = any(string_to_array(current_setting('nox.auth_rate_digests',true),','))
    or expires_at < statement_timestamp() - interval '24 hours'));
create policy auth_rate_insert on nox_foundation.auth_rate_bucket for insert to nox_app_runtime
with check (environment = current_setting('nox.environment',true)
  and realm = current_setting('nox.auth_rate_realm',true)
  and policy_ref = current_setting('nox.auth_rate_policy',true)
  and key_version = current_setting('nox.auth_rate_key',true)
  and subject_digest = any(string_to_array(current_setting('nox.auth_rate_digests',true),',')));
create policy auth_rate_update on nox_foundation.auth_rate_bucket for update to nox_app_runtime
using (environment = current_setting('nox.environment',true)
  and realm = current_setting('nox.auth_rate_realm',true)
  and policy_ref = current_setting('nox.auth_rate_policy',true)
  and key_version = current_setting('nox.auth_rate_key',true)
  and subject_digest = any(string_to_array(current_setting('nox.auth_rate_digests',true),',')))
with check (environment = current_setting('nox.environment',true)
  and realm = current_setting('nox.auth_rate_realm',true)
  and policy_ref = current_setting('nox.auth_rate_policy',true)
  and key_version = current_setting('nox.auth_rate_key',true)
  and subject_digest = any(string_to_array(current_setting('nox.auth_rate_digests',true),',')));
-- Bounded opportunistic retention only; no deletion of live budgets.
create policy auth_rate_retention on nox_foundation.auth_rate_bucket for delete to nox_app_runtime
using (environment = current_setting('nox.environment',true)
  and realm = current_setting('nox.auth_rate_realm',true)
  and expires_at < statement_timestamp() - interval '24 hours');

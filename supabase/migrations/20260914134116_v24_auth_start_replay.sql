-- AUTH-001 may reconcile only its original start result without recovering a
-- bearer cookie. The private runtime receives keyed nonce + exact request digest;
-- the HTTP projection is limited to flow ID/next step, never provider/actor data.
-- This SELECT-only path grants no UPDATE/INSERT capability. All operation claims
-- and transitions still require auth_flow_bound_access's independent cookie proof.
create policy auth_flow_start_replay_read on platform.auth_flow
  for select to nox_app_runtime
  using (realm='TENANT' and purpose='TENANT_LOGIN'
    and issued_host=current_setting('nox.request_host',true)
    and environment=current_setting('nox.environment',true)
    and tenant_id::text=current_setting('nox.tenant_id',true)
    and client_flow_nonce_digest=current_setting('nox.auth_start_nonce_digest',true)
    and request_digest=current_setting('nox.auth_start_request_digest',true));

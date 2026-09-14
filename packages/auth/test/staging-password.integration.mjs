import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createSupabasePasswordAdapter } from "../dist/supabase-password.js";
import {
  openStagingTestConnection,
  safeDatabaseFailureCode
} from "../../database/test/staging-connection.mjs";
import { createAuthFlowRepository } from "../../database/dist/auth-flow-repository.js";
import { readSupabaseCredentialState } from "../../database/dist/provider-credential-state.js";

test("real Staging provider verifies a temporary password identity without application authority", async () => {
  if (process.env.APP_ENV !== "staging") throw Error("STAGING_ONLY");
  const url = "https://uyfddpmbszjkhdkqvncz.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Error("MISSING_PROTECTED_AUTH_FIXTURE_KEY");
  // Public provider key read from the canonical Staging project; not a secret.
  const publishableKey = "sb_publishable_8VJhorH40fliafv7cUtcdg_WFv28ML-";
  const adapter = createSupabasePasswordAdapter({ environment: "staging", url, publishableKey });
  const email = `v24-auth-${randomUUID()}@example.test`;
  const password = `${randomBytes(32).toString("base64url")}aA1!`;
  const adminHeaders = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json"
  };
  let userId;
  let databaseFixture = false;
  const admin = openStagingTestConnection("postgres"),
    runtime = openStagingTestConnection();
  const tenantId = randomUUID(),
    actorId = randomUUID(),
    host = `v24-provider-${tenantId}.example.test`;
  let phase = "PROVISION";
  try {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ email, password, email_confirm: true })
    });
    if (!created.ok) throw Error("PROVISION_FAILED");
    const user = await created.json();
    if (typeof user.id !== "string" || !/^[0-9a-f-]{36}$/i.test(user.id))
      throw Error("INVALID_FIXTURE_ID");
    userId = user.id;
    phase = "VERIFY";
    const identity = await adapter.verifyPassword({ identifier: email, password });
    assert.equal(identity.kind, "VERIFIED");
    assert.equal(identity.subject, userId);
    assert.equal(identity.issuer, `${url}/auth/v1`);
    assert.equal(identity.assurance, "A1");
    assert.equal(identity.environment, "staging");
    assert.equal("tenantId" in identity, false);
    assert.equal("access_token" in identity, false);
    assert.equal("refresh_token" in identity, false);
    phase = "DENIAL";
    assert.deepEqual(
      await adapter.verifyPassword({ identifier: email, password: `${password}-wrong` }),
      { kind: "DENIED" }
    );
    phase = "CURRENT_CREDENTIAL";
    await admin.begin(async (tx) => {
      await tx`insert into platform.tenants(id,name,slug,status) values (${tenantId},'v24 credential fixture',${`v24-${tenantId}`},'ACTIVE')`;
      await tx`insert into platform.tenant_host_registry(host_ascii,tenant_id,route_kind,state,routing_version,policy_version)
        values (${host},${tenantId},'TENANT_CANONICAL','ACTIVE',1,'integration-only')`;
      await tx`insert into platform.tenant_users(id,tenant_id,state) values (${actorId},${tenantId},'ACTIVE')`;
      await tx`insert into platform.auth_principal_binding(id,tenant_id,actor_id,realm,provider_key,issuer,provider_subject,state)
        values (${randomUUID()},${tenantId},${actorId},'TENANT','supabase',${identity.issuer},${userId},'ACTIVE')`;
    });
    databaseFixture = true;
    const flows = createAuthFlowRepository(runtime);
    const scope = {
      tenantId,
      host,
      environment: "staging",
      flowSecretDigest: randomBytes(32).toString("hex"),
      routingVersion: 1,
      clientNonceDigest: randomBytes(32).toString("hex"),
      identifierDigest: randomBytes(32).toString("hex"),
      requestDigest: randomBytes(32).toString("hex"),
      keyVersion: "integration-only",
      requiredAssurance: "A1",
      policyVersion: "integration-only",
      safeReturnPath: "/materials"
    };
    const flow = await flows.start(scope);
    const operation = {
      ...scope,
      flowId: flow.id,
      operationDigest: randomBytes(32).toString("hex"),
      completionDigest: randomBytes(32).toString("hex")
    };
    const claim = await flows.claimProvider(operation);
    assert.ok(claim);
    assert.equal(
      await flows.recordProvider({
        ...operation,
        operationId: claim.operationId,
        result: identity
      }),
      true
    );
    const credential = async (patch = {}) =>
      runtime.begin(async (tx) => {
        await tx`select set_config('nox.tenant_id',${patch.tenantId ?? tenantId},true),set_config('nox.actor_id',${patch.actorId ?? actorId},true),
        set_config('nox.request_host',${patch.host ?? host},true),set_config('nox.environment',${patch.environment ?? "staging"},true),
        set_config('nox.auth_flow_digest',${patch.proof ?? scope.flowSecretDigest},true)`;
        return readSupabaseCredentialState(tx, flow.id);
      });
    assert.equal(await credential(), "CURRENT");
    for (const patch of [
      { proof: "a".repeat(64) },
      { actorId: randomUUID() },
      { tenantId: randomUUID() },
      { host: "other.example.test" },
      { environment: "production" }
    ])
      assert.equal(await credential(patch), "UNKNOWN");
    phase = "PRIVILEGE_METADATA";
    assert.equal((await runtime`select current_user as role`)[0].role, "nox_app_runtime");
    // Resolving a qualified Auth relation itself requires schema USAGE. Inspect
    // denied runtime grants as admin instead of granting USAGE to make a test pass.
    const grants =
      await admin`select has_function_privilege('anon','platform.read_auth_flow_credential_state(uuid)','EXECUTE') as anon,
      has_function_privilege('authenticated','platform.read_auth_flow_credential_state(uuid)','EXECUTE') as authenticated,
      has_function_privilege('nox_workflow_runtime','platform.read_auth_flow_credential_state(uuid)','EXECUTE') as workflow,
      has_table_privilege('nox_app_runtime','auth.users','SELECT') as users,
      has_table_privilege('nox_app_runtime','auth.sessions','SELECT') as sessions,
      has_schema_privilege('nox_app_runtime','auth','USAGE') as schema_usage`;
    assert.deepEqual(
      { ...grants[0] },
      {
        anon: false,
        authenticated: false,
        workflow: false,
        users: false,
        sessions: false,
        schema_usage: false
      }
    );
    phase = "NATIVE_REVOCATION";
    // Provider-controlled ban of this disposable identity; never mutate auth tables directly.
    const banned = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: adminHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ ban_duration: "1h" })
    });
    if (!banned.ok) throw Error("FIXTURE_BAN_FAILED");
    assert.equal(await credential(), "REVOKED");
  } catch (error) {
    throw Error(`STAGING_PASSWORD_ACCEPTANCE_FAILED:${phase}:${safeDatabaseFailureCode(error)}`);
  } finally {
    let databaseCleanupFailed = false;
    try {
      if (databaseFixture)
        await admin.begin(async (tx) => {
          await tx`delete from platform.auth_flow where tenant_id=${tenantId}`;
          await tx`delete from platform.auth_principal_binding where tenant_id=${tenantId}`;
          await tx`delete from platform.tenant_users where tenant_id=${tenantId}`;
          await tx`delete from platform.tenant_host_registry where tenant_id=${tenantId}`;
          await tx`delete from platform.tenants where id=${tenantId}`;
        });
    } catch {
      databaseCleanupFailed = true;
    } finally {
      const closed = await Promise.allSettled([admin.end(), runtime.end()]);
      databaseCleanupFailed = databaseCleanupFailed || closed.some((r) => r.status === "rejected");
    }
    if (userId) {
      const removed = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: adminHeaders,
        redirect: "error",
        signal: AbortSignal.timeout(10000)
      });
      if (!removed.ok) throw Error("STAGING_AUTH_FIXTURE_CLEANUP_FAILED");
      const absent = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        headers: adminHeaders,
        redirect: "error",
        signal: AbortSignal.timeout(10000)
      });
      if (absent.status !== 404) throw Error("STAGING_AUTH_FIXTURE_ABSENCE_NOT_PROVEN");
    }
    if (databaseCleanupFailed) throw Error("STAGING_CREDENTIAL_DB_CLEANUP_FAILED");
  }
});

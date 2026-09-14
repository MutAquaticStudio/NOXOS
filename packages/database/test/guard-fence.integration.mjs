import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { acquireGuardFences } from "../dist/guard-fence.js";
import { createTenantSessionRepository } from "../dist/tenant-session-repository.js";
import { createAuthFlowRepository } from "../dist/auth-flow-repository.js";
import { createAuthSessionIssuer } from "../dist/auth-session-issuer.js";
import { authenticateTenantSession } from "../../auth/dist/tenant-session.js";
import { issueSessionSecret, sessionSecretDigest } from "../../auth/dist/session-crypto.js";
import { parseStagingRuntimeUrl, safeDatabaseFailureCode } from "./staging-connection.mjs";

const STAGING_REF = "uyfddpmbszjkhdkqvncz";
function connection(role) {
  if (process.env.APP_ENV !== "staging")
    throw new Error("APP_ENV must be staging for the DB acceptance harness.");
  const url = parseStagingRuntimeUrl(process.env.NOX_RUNTIME_DATABASE_URL);
  if (role === "postgres") {
    if (!process.env.SUPABASE_DB_PASSWORD)
      throw new Error("Missing protected staging value: SUPABASE_DB_PASSWORD");
    // Reuse the existing protected migration credential, never add a new permanent test secret.
    url.username = `postgres.${STAGING_REF}`;
    url.password = process.env.SUPABASE_DB_PASSWORD;
  }
  return postgres(url.toString(), {
    prepare: false,
    max: 1,
    // Public CA from Supabase Studio's official hosted certificate URL.
    // The vendor's 'prod' CA names its hosted service, not our application environment.
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(new URL("./supabase-ca-2021.crt", import.meta.url), "utf8")
    },
    connect_timeout: 5,
    idle_timeout: 5
  });
}

test("Staging session issue is runtime-authorized, atomic, replay-safe and rollback-clean", async () => {
  const admin = connection("postgres");
  const runtime = connection("nox_app_runtime");
  const tenantId = randomUUID(),
    actorId = randomUUID(),
    policyId = randomUUID();
  const host = `v24-${tenantId}.example.test`,
    policyVersion = `${policyId}:1`;
  const key = { environment: "staging", version: "integration-only", bytes: randomBytes(32) };
  const rollback = Error("ROLLBACK_SYNTHETIC_SESSION_FIXTURE");
  let phase = "FIXTURE";
  let created = false;
  try {
    await admin.begin(async (outer) => {
      // Only synthetic fixture lifecycle uses the existing migration credential.
      assert.equal(
        (
          await outer`select count(*)::int n from platform.security_policy_version where scope='PLATFORM_FLOOR' and status='ACTIVE_VERSION'`
        )[0].n,
        0
      );
      await outer`insert into platform.security_policy_version(id,scope,version,status,
        required_assurance_by_action,idle_seconds,absolute_seconds,step_up_seconds,recovery_token_seconds,
        privileged_max_seconds,allowed_authenticator_classes,rate_policy_ref,detection_policy_ref,policy_hash,effective_at,created_by)
        values (${policyId},'PLATFORM_FLOOR',1,'ACTIVE_VERSION',${outer.json({ TENANT_LOGIN: "A1" })},
        1800,43200,300,900,1800,${outer.json(["PASSWORD"])},'test-rate','test-detection',${"a".repeat(64)},
        clock_timestamp()-interval '1 second','synthetic-rollback-only')`;
      await outer`insert into platform.tenants(id,name,slug,status) values (${tenantId},'v24 rollback session fixture',${`v24-${tenantId}`},'ACTIVE')`;
      await outer`insert into platform.tenant_users(id,tenant_id,state) values (${actorId},${tenantId},'ACTIVE')`;
      await outer`insert into platform.auth_principal_binding(id,tenant_id,actor_id,realm,provider_key,issuer,provider_subject,state)
        values (${randomUUID()},${tenantId},${actorId},'TENANT','supabase',${`https://${STAGING_REF}.supabase.co/auth/v1`},${actorId},'ACTIVE')`;
      await outer`insert into platform.tenant_host_registry(host_ascii,tenant_id,route_kind,state,routing_version,policy_version)
        values (${host},${tenantId},'TENANT_CANONICAL','ACTIVE',1,${policyVersion})`;
    });
    created = true;
    try {
      await runtime.begin(async (outer) => {
        // An independent limited-role connection executes the application code.
        // Rollback all session/audit writes without weakening append-only triggers.
        assert.equal((await outer`select current_user as name`)[0].name, "nox_app_runtime");
        const transaction = { begin: (fn) => outer.savepoint(fn) };
        const flows = createAuthFlowRepository(transaction);
        const scope = {
          tenantId,
          host,
          environment: "staging",
          flowSecretDigest: randomBytes(32).toString("hex"),
          routingVersion: 1,
          clientNonceDigest: randomBytes(32).toString("hex"),
          identifierDigest: randomBytes(32).toString("hex"),
          requestDigest: randomBytes(32).toString("hex"),
          keyVersion: key.version,
          requiredAssurance: "A1",
          policyVersion,
          safeReturnPath: "/materials"
        };
        phase = "VERIFIED_FLOW";
        const flow = await flows.start(scope),
          request = { ...scope, flowId: flow.id };
        const operation = await flows.claimProvider(request);
        assert.ok(operation);
        assert.equal(
          await flows.recordProvider({
            ...request,
            operationId: operation.operationId,
            result: {
              kind: "VERIFIED",
              providerKey: "supabase",
              issuer: `https://${STAGING_REF}.supabase.co/auth/v1`,
              subject: actorId,
              providerSessionId: randomUUID(),
              assurance: "A1",
              environment: "staging",
              verifiedAt: new Date().toISOString()
            }
          }),
          true
        );
        phase = "OUTBOX_FAILURE_ROLLBACK";
        // Inject a real SQL failure at the outbox boundary; do not fake the database,
        // alter production code, or disable immutable triggers for the test.
        const failing = {
          begin: (fn) =>
            outer.savepoint((tx) =>
              fn(
                new Proxy(tx, {
                  apply(target, receiver, args) {
                    if (
                      Array.isArray(args[0]) &&
                      args[0].join("").includes("insert into nox_foundation.outbox")
                    )
                      return target`select 1/0`;
                    return Reflect.apply(target, receiver, args);
                  }
                })
              )
            )
        };
        let outboxRejected = false;
        try {
          await createAuthSessionIssuer(failing, key).issue(request);
        } catch (error) {
          if (error.code !== "22012") throw error;
          outboxRejected = true;
        }
        assert.equal(outboxRejected, true);
        assert.equal(
          (await outer`select state from platform.auth_flow where id=${flow.id}`)[0].state,
          "PRIMARY_VERIFIED"
        );
        for (const table of ["platform.security_event", "nox_foundation.outbox"])
          assert.equal(
            (
              await outer`select count(*)::int n from ${outer(table)} where tenant_id=${tenantId}`
            )[0].n,
            0
          );
        phase = "ISSUE_AND_REPLAY";
        const issuer = createAuthSessionIssuer(transaction, key);
        await assert.rejects(
          () => issuer.issue({ ...request, flowSecretDigest: "b".repeat(64) }),
          /AUTH_FLOW_UNAVAILABLE/
        );
        const issued = await issuer.issue(request);
        // Success with the same unique auth_operation_id also proves that the
        // failed transaction left no hidden session behind the digest-only RLS.
        assert.equal(issued.kind, "ISSUED");
        assert.equal(Buffer.from(issued.secret, "base64url").length, 32);
        assert.deepEqual(await issuer.issue(request), {
          kind: "ORIGINAL_RESULT",
          sessionId: issued.sessionId
        });
        const digest = sessionSecretDigest(issued.secret, key).digest;
        await outer`select set_config('nox.session_digest',${digest},true)`;
        const rows =
          await outer`select secret_digest,actor_id,tenant_id,credential_epoch::text,authorization_epoch::text
        from platform.application_session where id=${issued.sessionId}`;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].secret_digest, digest);
        assert.equal(rows[0].actor_id, actorId);
        assert.equal(rows[0].tenant_id, tenantId);
        assert.equal(rows[0].credential_epoch, "1");
        assert.equal(rows[0].authorization_epoch, "1");
        for (const table of ["platform.security_event", "nox_foundation.outbox"])
          assert.equal(
            (
              await outer`select count(*)::int n from ${outer(table)} where tenant_id=${tenantId}`
            )[0].n,
            1
          );
        const events =
          await outer`select *,sequence::text as sequence_text from platform.security_event where tenant_id=${tenantId}`;
        const event = events[0];
        const canonicalEvent = Buffer.from(
          JSON.stringify({
            actorId: event.actor_id,
            environment: event.environment,
            eventId: event.id,
            flowId: event.flow_id,
            host: event.issued_host,
            occurredAt: event.occurred_at.toISOString(),
            policyVersion: event.policy_version,
            previousDigest: event.previous_digest,
            sequence: event.sequence_text,
            sessionId: event.session_id,
            tenantId: event.tenant_id,
            type: event.event_type
          })
        );
        const length = Buffer.alloc(8);
        length.writeBigUInt64BE(BigInt(canonicalEvent.length));
        assert.equal(
          event.event_digest,
          createHash("sha3-256")
            .update(Buffer.concat([Buffer.from("noxos:v1:audit-event\0"), length, canonicalEvent]))
            .digest("hex")
        );
        assert.equal(events[0].previous_digest, "0".repeat(64));
        assert.equal(
          (
            await outer`select state,issued_session_id from platform.auth_flow where id=${flow.id}`
          )[0].issued_session_id,
          issued.sessionId
        );
        phase = "IMMUTABILITY";
        await assert.rejects(
          () =>
            outer.savepoint(
              (tx) =>
                tx`update platform.security_policy_version set version=version+1 where id=${policyId}`
            ),
          { code: "23514" }
        );
        await assert.rejects(
          () =>
            outer.savepoint(
              (tx) => tx`delete from platform.security_event where tenant_id=${tenantId}`
            ),
          { code: "42501" }
        );
        throw rollback;
      });
      assert.fail("Synthetic fixture must rollback");
    } catch (error) {
      if (error !== rollback) throw error;
    }
    phase = "CLEANUP_VERIFIED";
    for (const table of [
      "platform.auth_flow",
      "platform.application_session",
      "platform.security_event",
      "nox_foundation.outbox"
    ])
      assert.equal(
        (await admin`select count(*)::int n from ${admin(table)} where tenant_id=${tenantId}`)[0].n,
        0
      );
  } catch (error) {
    throw Error(`STAGING_SESSION_COMMIT_FAILED:${phase}:${safeDatabaseFailureCode(error)}`);
  } finally {
    try {
      if (created) {
        await admin.begin(async (tx) => {
          await tx`delete from platform.auth_principal_binding where tenant_id=${tenantId}`;
          await tx`delete from platform.tenant_host_registry where tenant_id=${tenantId}`;
          await tx`delete from platform.tenant_users where tenant_id=${tenantId}`;
          await tx`delete from platform.tenants where id=${tenantId}`;
          await tx`delete from platform.security_policy_version where id=${policyId} and created_by='synthetic-rollback-only'`;
        });
        assert.equal(
          (await admin`select count(*)::int n from platform.tenants where id=${tenantId}`)[0].n,
          0
        );
        assert.equal(
          (
            await admin`select count(*)::int n from platform.security_policy_version where id=${policyId}`
          )[0].n,
          0
        );
      }
    } finally {
      await Promise.all([admin.end(), runtime.end()]);
    }
  }
});

test("Staging real runtime RLS, same-transaction fences, concurrent modes and cleanup", async () => {
  // Admin is used only for synthetic fixture lifecycle, never the acceptance queries.
  const admin = connection("postgres");
  const reader = connection("nox_app_runtime");
  const contender = connection("nox_app_runtime");
  const tenantA = randomUUID(),
    tenantB = randomUUID(),
    fixture = `v24-guard-${randomUUID()}`;
  const base = {
    scope: "TENANT",
    tenantId: tenantA,
    ownerGate: "G1",
    objectType: "test",
    objectId: fixture,
    mode: "SHARED"
  };
  const context = async (tx, tenantId) => {
    await tx`select set_config('nox.actor_id','v24-guard-acceptance',true),
      set_config('nox.scope','TENANT',true),set_config('nox.tenant_id',${tenantId},true)`;
  };
  let created = false;
  try {
    const role =
      await reader`select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user`;
    assert.equal(role[0].name, "nox_app_runtime");
    assert.equal(role[0].rolsuper, false);
    assert.equal(role[0].rolbypassrls, false);
    await admin`insert into nox_foundation.guard_fence(scope,tenant_id,owner_gate,object_type,object_id)
      values ('TENANT',${tenantA}::uuid,'G1','test',${fixture}),('TENANT',${tenantB}::uuid,'G1','test',${fixture})`;
    created = true;
    await reader.begin(async (tx) => {
      await context(tx, tenantA);
      const visible =
        await tx`select tenant_id::text from nox_foundation.guard_fence where object_id=${fixture}`;
      assert.deepEqual(
        visible.map((row) => row.tenant_id),
        [tenantA]
      );
      await assert.rejects(
        () => acquireGuardFences(tx, [{ ...base, tenantId: tenantB }]),
        /UNKNOWN_REQUIRED_GUARD/
      );
      assert.equal((await acquireGuardFences(tx, [base]))[0].epoch, "1");
    });
    // Transaction-local context must not leak back into a pooled connection.
    assert.equal(
      (
        await reader`select count(*)::int as count from nox_foundation.guard_fence where object_id=${fixture}`
      )[0].count,
      0
    );

    let unlock, acquired, rejectAcquired;
    const released = new Promise((resolve) => {
      unlock = resolve;
    });
    const locked = new Promise((resolve, reject) => {
      acquired = resolve;
      rejectAcquired = reject;
    });
    const holder = reader
      .begin(async (tx) => {
        await context(tx, tenantA);
        await acquireGuardFences(tx, [base]);
        acquired();
        await released;
      })
      .catch((error) => {
        rejectAcquired(error);
        throw error;
      });
    try {
      await locked;
      await contender.begin(async (tx) => {
        await context(tx, tenantA);
        await tx`set local lock_timeout='500ms'`;
        assert.equal((await acquireGuardFences(tx, [base]))[0].epoch, "1");
      });
      await assert.rejects(
        () =>
          contender.begin(async (tx) => {
            await context(tx, tenantA);
            await tx`set local lock_timeout='500ms'`;
            await acquireGuardFences(tx, [{ ...base, mode: "EXCLUSIVE" }]);
          }),
        (error) => error.code === "55P03"
      );
    } finally {
      unlock();
      await holder;
    }
    await contender.begin(async (tx) => {
      await context(tx, tenantA);
      await acquireGuardFences(tx, [{ ...base, mode: "EXCLUSIVE" }]);
      await tx`update nox_foundation.guard_fence set epoch=epoch+1 where tenant_id=${tenantA}::uuid and object_id=${fixture}`;
    });
    assert.equal(
      (
        await admin`select epoch::text from nox_foundation.guard_fence where tenant_id=${tenantA}::uuid and object_id=${fixture}`
      )[0].epoch,
      "2"
    );
  } catch (error) {
    // Do not allow provider error objects to dump connection details into cloud artifacts.
    throw new Error(`STAGING_GUARD_FAILED:${safeDatabaseFailureCode(error)}`);
  } finally {
    try {
      if (created) {
        await admin`delete from nox_foundation.guard_fence where owner_gate='G1' and object_type='test'
          and object_id=${fixture} and tenant_id in (${tenantA}::uuid,${tenantB}::uuid)`;
        assert.equal(
          (
            await admin`select count(*)::int as count from nox_foundation.guard_fence where object_id=${fixture}`
          )[0].count,
          0
        );
      }
    } finally {
      await Promise.all([admin.end(), reader.end(), contender.end()]);
    }
  }
});

test("Staging auth flow replay, exclusive provider claim and terminal integrity", async () => {
  const admin = connection("postgres"),
    runtime = connection("nox_app_runtime"),
    other = connection("nox_app_runtime");
  const repository = createAuthFlowRepository(runtime),
    competitor = createAuthFlowRepository(other);
  const tenantId = randomUUID(),
    host = `v24-${tenantId}.example.test`;
  const input = {
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
  let created = false;
  let phase = "FIXTURE";
  try {
    await admin.begin(async (tx) => {
      await tx`insert into platform.tenants(id,name,slug,status) values (${tenantId},'v24 flow fixture',${`v24-${tenantId}`},'ACTIVE')`;
      await tx`insert into platform.tenant_host_registry(host_ascii,tenant_id,route_kind,state,routing_version,policy_version)
        values (${host},${tenantId},'TENANT_CANONICAL','ACTIVE',1,'integration-only')`;
    });
    created = true;
    phase = "START";
    const initial = await repository.start(input);
    assert.deepEqual(await repository.start(input), initial);
    await assert.rejects(
      () => repository.start({ ...input, requestDigest: "a".repeat(64) }),
      /AUTH_FLOW_REPLAY_CONFLICT/
    );
    phase = "CLAIM";
    const request = { ...input, flowId: initial.id };
    assert.equal(
      await repository.claimProvider({ ...request, flowSecretDigest: "b".repeat(64) }),
      null
    );
    const results = await Promise.all([
      repository.claimProvider(request),
      competitor.claimProvider(request)
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const winner = results.find(Boolean);
    assert.equal(await repository.claimProvider(request), null);
    phase = "RESULT";
    assert.equal(
      await repository.recordProvider({
        ...request,
        operationId: randomUUID(),
        result: { kind: "DENIED" }
      }),
      false
    );
    assert.equal(
      await repository.recordProvider({
        ...request,
        operationId: winner.operationId,
        result: { kind: "PENDING_RECONCILIATION" }
      }),
      false
    );
    assert.equal(
      await repository.recordProvider({
        ...request,
        operationId: winner.operationId,
        result: { kind: "DENIED" }
      }),
      true
    );
    assert.equal(
      await repository.recordProvider({
        ...request,
        operationId: winner.operationId,
        result: { kind: "DENIED" }
      }),
      false
    );
    phase = "TERMINAL";
    await assert.rejects(
      () =>
        admin`update platform.auth_flow set state='INITIATED',terminal_at=null,entity_version=entity_version+1 where id=${initial.id}`,
      { code: "23514" }
    );
    assert.equal((await runtime`select count(*)::int n from platform.auth_flow`)[0].n, 0);
  } catch (error) {
    throw Error(`STAGING_AUTH_FLOW_FAILED:${phase}:${safeDatabaseFailureCode(error)}`);
  } finally {
    try {
      if (created)
        await admin.begin(async (tx) => {
          await tx`delete from platform.auth_flow where tenant_id=${tenantId}`;
          await tx`delete from platform.tenant_host_registry where tenant_id=${tenantId}`;
          await tx`delete from platform.tenants where id=${tenantId}`;
        });
    } finally {
      await Promise.all([admin.end(), runtime.end(), other.end()]);
    }
  }
});

test("Staging fixed-tenant session repository reads current authority through runtime RLS", async () => {
  const admin = connection("postgres");
  const runtime = connection("nox_app_runtime");
  const tenantA = randomUUID(),
    tenantB = randomUUID(),
    actor = randomUUID();
  const binding = randomUUID(),
    session = randomUUID();
  const host = `v24-${tenantA}.example.test`;
  const key = {
    version: "integration-only",
    environment: "staging",
    bytes: Buffer.from(randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""), "hex")
  };
  const token = issueSessionSecret(key);
  const now = Date.now();
  const date = (offset) => new Date(now + offset);
  const dependencies = {
    environment: "staging",
    keys: [key],
    repository: createTenantSessionRepository(runtime),
    now: () => now
  };
  const request = { exactRequestHost: host, cookieHeader: `__Host-noxos-session=${token.secret}` };
  try {
    assert.equal((await runtime`select current_user as name`)[0].name, "nox_app_runtime");
    await admin.begin(async (tx) => {
      await tx`insert into platform.tenants(id,name,slug,status) values
        (${tenantA},'v24 synthetic session A',${`v24-${tenantA}`},'ACTIVE'),
        (${tenantB},'v24 synthetic session B',${`v24-${tenantB}`},'ACTIVE')`;
      await tx`insert into platform.tenant_users(id,tenant_id,state) values (${actor},${tenantA},'ACTIVE')`;
      await tx`insert into platform.auth_principal_binding(id,tenant_id,actor_id,realm,provider_key,issuer,provider_subject,state)
        values (${binding},${tenantA},${actor},'TENANT','supabase',
          'https://uyfddpmbszjkhdkqvncz.supabase.co/auth/v1',${actor},'ACTIVE')`;
      await tx`insert into platform.tenant_host_registry(host_ascii,tenant_id,route_kind,state,routing_version,policy_version)
        values (${host},${tenantA},'TENANT_CANONICAL','ACTIVE',1,'integration-only')`;
      await tx`insert into platform.application_session(id,auth_operation_id,binding_id,actor_id,tenant_id,
          actor_kind,realm,mode,assurance,environment,secret_digest,token_digest_policy,token_digest_key_version,
          issued_host,routing_version_at_issue,credential_epoch,authorization_epoch,
          issued_at,last_authoritative_activity_at,idle_expires_at,absolute_expires_at,state)
        values (${session},${randomUUID()},${binding},${actor},${tenantA},'TENANT_USER','TENANT','NORMAL','A1',
          'staging',${token.stored.digest},'HMAC-SHA3-256-KEYED-V1',${key.version},${host},1,1,1,
          ${date(-1000)},${date(-500)},${date(600000)},${date(3600000)},'ACTIVE')`;
    });
    const current = await authenticateTenantSession(request, dependencies);
    assert.equal(current?.actorId, actor);
    assert.equal(current?.tenantId, tenantA);
    assert.equal(
      await authenticateTenantSession(
        { ...request, exactRequestHost: `v24-${tenantB}.example.test` },
        dependencies
      ),
      null
    );
    // A wrong keyed digest cannot enumerate a session even on the correct host.
    assert.equal(
      await authenticateTenantSession(
        { ...request, cookieHeader: `__Host-noxos-session=${issueSessionSecret(key).secret}` },
        dependencies
      ),
      null
    );
    assert.equal(
      (
        await runtime`select count(*)::int as n from platform.application_session where id=${session}`
      )[0].n,
      0
    );
    assert.equal(
      (await runtime`select count(*)::int as n from platform.tenant_users where id=${actor}`)[0].n,
      0
    );
    await admin`update platform.tenant_users set authorization_epoch=authorization_epoch+1,entity_version=entity_version+1 where id=${actor}`;
    assert.equal(await authenticateTenantSession(request, dependencies), null);
  } catch (error) {
    throw Error(`STAGING_SESSION_FAILED:${safeDatabaseFailureCode(error)}`);
  } finally {
    try {
      await admin.begin(async (tx) => {
        await tx`delete from platform.application_session where id=${session} and tenant_id=${tenantA}`;
        await tx`delete from platform.auth_principal_binding where id=${binding} and tenant_id=${tenantA}`;
        await tx`delete from platform.tenant_host_registry where host_ascii=${host} and tenant_id=${tenantA}`;
        await tx`delete from platform.tenant_users where id=${actor} and tenant_id=${tenantA}`;
        await tx`delete from platform.tenants where id in (${tenantA},${tenantB})`;
      });
    } catch (error) {
      throw Error(`STAGING_SESSION_CLEANUP_FAILED:${safeDatabaseFailureCode(error)}`);
    } finally {
      await Promise.all([admin.end(), runtime.end()]);
    }
  }
});

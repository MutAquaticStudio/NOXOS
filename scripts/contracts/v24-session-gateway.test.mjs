import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticateTenantSession,
  authenticateTenantMutation
} from "../../packages/auth/dist/tenant-session.js";
import { tenantCsrfProof, verifyTenantCsrfProof } from "../../packages/auth/dist/session-csrf.js";
import { issueSessionSecret } from "../../packages/auth/dist/session-crypto.js";
const key = { version: "test", environment: "staging", bytes: Buffer.alloc(32, 9) };
const token = issueSessionSecret(key);
const now = Date.parse("2026-09-14T05:00:00.000Z");
function fixture() {
  return {
    secret: token.stored,
    session: {
      id: "s1",
      actorId: "u1",
      tenantId: "t1",
      actorKind: "TENANT_USER",
      realm: "TENANT",
      mode: "NORMAL",
      state: "ACTIVE",
      assurance: "A1",
      entityVersion: 1,
      issuedHost: "a.example.test",
      routingVersionAtIssue: 1,
      credentialEpoch: "c1",
      authorizationEpoch: "a1",
      issuedAt: "2026-09-14T04:00:00.000Z",
      lastAuthoritativeActivityAt: "2026-09-14T04:55:00.000Z",
      idleExpiresAt: "2026-09-14T05:10:00.000Z",
      absoluteExpiresAt: "2026-09-14T06:00:00.000Z"
    },
    authority: {
      tenantId: "t1",
      actorId: "u1",
      host: "a.example.test",
      routingVersion: 1,
      routeState: "ACTIVE",
      actorState: "ACTIVE",
      tenantState: "ACTIVE",
      bindingState: "ACTIVE",
      credentialEpoch: "c1",
      authorizationEpoch: "a1"
    }
  };
}
const request = {
  cookieHeader: `__Host-noxos-session=${token.secret}`,
  exactRequestHost: "a.example.test"
};
function deps(readCurrent) {
  return { keys: [key], environment: "staging", repository: { readCurrent }, now: () => now };
}

test("mutation gateway requires both current session and session-bound CSRF with exact origin", async () => {
  let record = fixture();
  const dependencies = deps(async () => [record]);
  const context = await authenticateTenantSession(request, dependencies);
  const proof = tenantCsrfProof(context, key);
  const mutation = {
    ...request,
    method: "POST",
    origin: "https://a.example.test",
    fetchSite: "same-origin",
    csrfProof: proof
  };
  assert.deepEqual(await authenticateTenantMutation(mutation, dependencies), context);
  for (const patch of [
    { csrfProof: undefined },
    { csrfProof: proof + "=" },
    { origin: undefined },
    { origin: "https://evil.example.test" },
    { fetchSite: "cross-site" },
    { method: "GET" },
    { cookieHeader: undefined }
  ])
    assert.equal(await authenticateTenantMutation({ ...mutation, ...patch }, dependencies), null);
  for (const patch of [
    { sessionId: "another" },
    { tenantId: "other" },
    { actorId: "other" },
    { issuedHost: "b.example.test" },
    { routingVersion: 2 },
    { authorizationEpoch: "a2" }
  ])
    assert.equal(verifyTenantCsrfProof(proof, { ...context, ...patch }, key), false);
  assert.equal(verifyTenantCsrfProof(proof, context, { ...key, environment: "production" }), false);
  assert.equal(verifyTenantCsrfProof(proof, context, { ...key, version: "rotated" }), false);
  record.session.state = "REVOKED";
  assert.equal(await authenticateTenantMutation(mutation, dependencies), null);
});

test("compiled session gateway delivers only server-selected context, never secrets", async () => {
  const result = await authenticateTenantSession(
    { ...request, tenantId: "forged", role: "owner" },
    deps(async (input) => {
      assert.equal(JSON.stringify(input).includes(token.secret), false);
      assert.equal(input.host, "a.example.test");
      return [fixture()];
    })
  );
  assert.equal(result.tenantId, "t1");
  assert.equal(result.actorId, "u1");
  assert.equal("role" in result, false);
  assert.equal("secret" in result, false);
  assert.ok(Object.isFrozen(result));
});

test("each request rereads current authority; changed epoch invalidates the next request", async () => {
  let calls = 0;
  const dependencies = deps(async () => {
    const record = fixture();
    if (++calls > 1) record.authority.authorizationEpoch = "a2";
    return [record];
  });
  assert.notEqual(await authenticateTenantSession(request, dependencies), null);
  assert.equal(await authenticateTenantSession(request, dependencies), null);
  assert.equal(calls, 2);
});

test("JWT-only, ambiguous/missing persistence, wrong host and backend outage never fall back", async () => {
  let queried = false;
  assert.equal(
    await authenticateTenantSession(
      { exactRequestHost: request.exactRequestHost, authorization: "Bearer forged" },
      deps(async () => {
        queried = true;
        return [fixture()];
      })
    ),
    null
  );
  assert.equal(queried, false);
  for (const rows of [[], [fixture(), fixture()]])
    assert.equal(
      await authenticateTenantSession(
        request,
        deps(async () => rows)
      ),
      null
    );
  assert.equal(
    await authenticateTenantSession(
      { ...request, exactRequestHost: "b.example.test" },
      deps(async () => [fixture()])
    ),
    null
  );
  assert.equal(
    await authenticateTenantSession(
      request,
      deps(async () => {
        throw Error("backend unavailable");
      })
    ),
    null
  );
  assert.equal(
    await authenticateTenantSession(request, {
      ...deps(async () => [fixture()]),
      environment: "production"
    }),
    null
  );
});

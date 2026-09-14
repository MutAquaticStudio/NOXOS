import test from "node:test";
import assert from "node:assert/strict";
import { createSupabasePasswordAdapter } from "../../packages/auth/dist/supabase-password.js";
const url = "https://uyfddpmbszjkhdkqvncz.supabase.co";
const now = 1800000000000;
const subject = "6c79d612-7c97-4b7d-a0f2-6eec6f1b955a";
const session = "52d1321e-fc3b-4cb3-bc72-5b1adfc37db0";
const options = {
  environment: "staging",
  url,
  publishableKey: "sb_publishable_synthetic",
  now: () => now
};
const credentials = { identifier: "fixture@example.test", password: "synthetic-test-only" };
const claims = {
  iss: `${url}/auth/v1`,
  aud: "authenticated",
  sub: subject,
  session_id: session,
  aal: "aal1",
  iat: now / 1000 - 1,
  exp: now / 1000 + 60
};
function token(data) {
  return `e30.${Buffer.from(JSON.stringify(data)).toString("base64url")}.c2ln`;
}
const user = {
  id: subject,
  is_anonymous: false,
  email_confirmed_at: "2026-01-01T00:00:00Z",
  user_metadata: { tenantId: "forged", role: "OWNER" }
};
test("password adapter uses exact server endpoints and emits no provider secrets or authority", async () => {
  const calls = [];
  const adapter = createSupabasePasswordAdapter({
    ...options,
    request: async (endpoint, init) => {
      calls.push([endpoint, init]);
      return Response.json(
        calls.length === 1 ? { access_token: token(claims), refresh_token: "never-return" } : user
      );
    }
  });
  const result = await adapter.verifyPassword(credentials);
  assert.deepEqual(result, {
    kind: "VERIFIED",
    providerKey: "supabase",
    issuer: `${url}/auth/v1`,
    subject,
    providerSessionId: session,
    assurance: "A1",
    environment: "staging",
    verifiedAt: now
  });
  assert.deepEqual(
    calls.map(([endpoint]) => endpoint),
    [`${url}/auth/v1/token?grant_type=password`, `${url}/auth/v1/user`]
  );
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    email: credentials.identifier,
    password: credentials.password
  });
  for (const [, init] of calls) {
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal);
  }
  assert.equal(calls[1][1].headers.authorization, `Bearer ${token(claims)}`);
  assert.doesNotMatch(JSON.stringify(result), /refresh_token|access_token|password|tenantId|OWNER/);
});
test("cross-project configuration and malformed provider claims fail closed", async () => {
  for (const change of [
    { environment: "preview" },
    { url: "https://soioshmcdwxhlgrjzkoc.supabase.co" },
    { publishableKey: "sb_secret_forbidden" }
  ])
    assert.throws(() => createSupabasePasswordAdapter({ ...options, ...change }), /CONFIGURATION/);
  for (const change of [
    { iss: "https://other.test/auth/v1" },
    { aud: "service_role" },
    { exp: now / 1000 },
    { iat: now / 1000 + 1 },
    { sub: "bad" },
    { session_id: "bad" },
    { aal: "unknown" }
  ]) {
    let calls = 0;
    const adapter = createSupabasePasswordAdapter({
      ...options,
      request: async () => {
        calls++;
        return Response.json({ access_token: token({ ...claims, ...change }) });
      }
    });
    assert.deepEqual(await adapter.verifyPassword(credentials), { kind: "DENIED" });
    assert.equal(calls, 1);
  }
});
test("decoded token never suffices: native server denial, mismatched subject and unverified email deny", async () => {
  for (const response of [
    new Response(null, { status: 401 }),
    Response.json({ ...user, id: session }),
    Response.json({ ...user, email_confirmed_at: null }),
    Response.json({ ...user, is_anonymous: true })
  ]) {
    let calls = 0;
    const adapter = createSupabasePasswordAdapter({
      ...options,
      request: async () =>
        ++calls === 1 ? Response.json({ access_token: token(claims) }) : response
    });
    assert.deepEqual(await adapter.verifyPassword(credentials), { kind: "DENIED" });
    assert.equal(calls, 2);
  }
});
test("provider outage is reconciled without retry, invalid credentials share one denial shape", async () => {
  for (const status of [400, 401, 403, 422, 429]) {
    const adapter = createSupabasePasswordAdapter({
      ...options,
      request: async () => new Response("private reason", { status })
    });
    assert.deepEqual(await adapter.verifyPassword(credentials), { kind: "DENIED" });
  }
  let calls = 0;
  const adapter = createSupabasePasswordAdapter({
    ...options,
    request: async () => {
      calls++;
      throw Error("sensitive provider transport details");
    }
  });
  assert.deepEqual(await adapter.verifyPassword(credentials), { kind: "PENDING_RECONCILIATION" });
  assert.equal(calls, 1);
});

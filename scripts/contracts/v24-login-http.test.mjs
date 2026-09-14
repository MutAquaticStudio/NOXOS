import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createTenantLoginHttp } from "../../apps/nox-os/server/tenant-login-http.ts";

const host = "staging.example.test",
  now = 1800000000000;
const flowId = "11111111-1111-4111-8111-111111111111";
const secret = randomBytes(32).toString("base64url");
function digest(purpose, material) {
  const bytes = Buffer.from(JSON.stringify(material)),
    size = Buffer.alloc(8);
  size.writeBigUInt64BE(BigInt(bytes.length));
  return createHash("sha3-256")
    .update(Buffer.concat([Buffer.from(`noxos:v1:${purpose}\0`), size, bytes]))
    .digest("hex");
}
const fields = {
  identifier: "synthetic@example.test",
  clientFlowNonce: secret,
  requestDigest: "a".repeat(64),
  digestPolicyVersion: "FIPS202-SHA3-256-DOMAIN-SEPARATED-V1",
  returnTo: "/materials"
};
fields.requestDigest = digest("tenant-login-start", {
  clientFlowNonce: fields.clientFlowNonce,
  digestPolicyVersion: fields.digestPolicyVersion,
  identifier: fields.identifier,
  providerMethod: "PASSWORD",
  returnTo: fields.returnTo
});
function request(body = JSON.stringify(fields), patch = {}) {
  return new Request(`https://${host}/api/auth/tenant/login/start`, {
    method: "POST",
    headers: { origin: `https://${host}`, "content-type": "application/json" },
    body,
    ...patch
  });
}
function fixture() {
  const calls = [];
  const service = {
    async isActiveTenantHost(value) {
      calls.push(["host", value]);
      return value === host;
    },
    async start(input) {
      calls.push(["start", input]);
      return { flowId, secret, expiresAt: now + 900000 };
    },
    async complete(input) {
      calls.push(["complete", input]);
      return { kind: "ISSUED", secret, absoluteExpiresAt: now + 3600000 };
    }
  };
  return {
    calls,
    service,
    handler: createTenantLoginHttp({ service, returnPaths: ["/materials"], now: () => now })
  };
}

test("start resolves host first, emits opaque flow cookie only and disables caching", async () => {
  const f = fixture(),
    response = await f.handler(request());
  assert.equal(response.status, 202);
  assert.deepEqual(
    f.calls.map((x) => x[0]),
    ["host", "start"]
  );
  assert.deepEqual(await response.json(), { flowId, next: "PASSWORD" });
  assert.match(response.headers.get("set-cookie"), /^__Host-noxos-auth=/);
  assert.match(
    response.headers.get("set-cookie"),
    /Secure; HttpOnly; SameSite=Strict; Max-Age=900$/
  );
  assert.equal(response.headers.get("set-cookie").includes("Domain="), false);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
});

test("complete keeps password transient and rotates cookies, never returns any secret in JSON", async () => {
  const f = fixture();
  const input = {
    identifier: fields.identifier,
    password: "synthetic-test-only-password",
    flowId,
    operationKey: secret,
    requestDigest: fields.requestDigest,
    digestPolicyVersion: fields.digestPolicyVersion
  };
  input.requestDigest = digest("tenant-login-complete", {
    digestPolicyVersion: input.digestPolicyVersion,
    flowId: input.flowId,
    identifier: input.identifier,
    operationKey: input.operationKey
  });
  const response = await f.handler(
    new Request(`https://${host}/api/auth/tenant/login/complete`, {
      method: "POST",
      headers: {
        origin: `https://${host}`,
        "content-type": "application/json",
        cookie: `__Host-noxos-auth=${secret}`
      },
      body: JSON.stringify(input)
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "AUTHENTICATED" });
  assert.equal(f.calls[1][1].fields.password, input.password);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.match(response.headers.getSetCookie()[0], /^__Host-noxos-session=/);
  assert.match(response.headers.getSetCookie()[1], /^__Host-noxos-auth=;.*Max-Age=0$/);
});

test("malformed, duplicate, nested, unknown and oversized requests never reach credentials", async () => {
  for (const body of [
    '{"identifier":"a","identifier":"b"}',
    JSON.stringify(fields).replace('"identifier":', '"identifi\\u0065r":"duplicate","identifier":'),
    JSON.stringify({ ...fields, tenantId: "forged" }),
    JSON.stringify({ ...fields, identifier: { value: "x" } }),
    JSON.stringify({ ...fields, identifier: "\ud800" }),
    JSON.stringify({ ...fields, returnTo: "//evil.test" }),
    JSON.stringify({ ...fields, requestDigest: "not-a-digest" }),
    JSON.stringify({ ...fields, requestDigest: "b".repeat(64) }),
    JSON.stringify({ ...fields, providerMethod: "MAGIC_ADMIN" }),
    JSON.stringify(fields) + " garbage",
    JSON.stringify(fields).slice(0, -1) + ",}",
    " ".repeat(16385),
    "[]"
  ]) {
    const f = fixture(),
      response = await f.handler(request(body));
    assert.equal(response.status, 400);
    assert.equal(
      f.calls.some((x) => x[0] === "start"),
      false
    );
  }
});

test("wrong host/origin/method/content type is rejected before service credential work", async () => {
  for (const patch of [
    { headers: { origin: "https://evil.test", "content-type": "application/json" } },
    { headers: { origin: `https://${host}`, "content-type": "text/plain" } },
    {
      headers: {
        origin: `https://${host}`,
        "content-type": "application/json",
        "sec-fetch-site": "cross-site"
      }
    },
    {
      headers: { origin: `https://${host}`, "content-type": "application/json", host: "other.test" }
    },
    { method: "PUT" },
    {
      headers: {
        origin: `https://${host}`,
        "content-type": "application/json",
        "content-length": "20000"
      }
    }
  ]) {
    const f = fixture();
    assert.equal((await f.handler(request(undefined, patch))).status, 400);
    assert.equal(
      f.calls.some((x) => x[0] === "start"),
      false
    );
  }
  const f = fixture();
  f.service.isActiveTenantHost = async () => false;
  assert.equal((await f.handler(request())).status, 400);
  assert.equal(f.calls.length, 0);
});

test("provider failure uses a generic envelope without exception, password or SQL disclosure", async () => {
  const f = fixture();
  f.service.start = async () => {
    throw Error("SQL password=never-log-this");
  };
  const response = await f.handler(request()),
    text = await response.text();
  assert.equal(response.status, 400);
  assert.equal(/SQL|password=|never-log/.test(text), false);
  assert.equal(response.headers.has("set-cookie"), false);
});

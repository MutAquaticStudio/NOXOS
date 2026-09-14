import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { createTenantLoginStart } from "../../apps/nox-os/server/tenant-login-start.ts";
function frameDigestPayload(purpose, bytes) {
  const size = Buffer.alloc(8);
  size.writeBigUInt64BE(BigInt(bytes.length));
  return Buffer.concat([Buffer.from(`noxos:v1:${purpose}\0`), size, bytes]);
}

const host = "staging.example.test",
  tenantId = "11111111-1111-4111-8111-111111111111";
const key = { version: "test-only", environment: "staging", bytes: randomBytes(32) };
function fixture() {
  const calls = [];
  const entry = {
    tenantId,
    routingVersion: 1,
    policyVersion: "test-policy",
    ratePolicyRef: "test-rate",
    requiredAssurance: "A1",
    budgets: Object.fromEntries(
      ["FLOW", "IDENTIFIER", "NETWORK"].map((d) => [d, { limit: 5, windowSeconds: 60 }])
    )
  };
  const row = {
    id: tenantId,
    state: "INITIATED",
    expiresAt: new Date(Date.now() + 899000),
    created: true,
    proofMatches: true
  };
  const options = {
    key,
    returnPaths: ["/materials"],
    resolveEntry: async () => entry,
    rate: {
      consume: async (value) => {
        calls.push(["rate", value]);
        return "ALLOW";
      }
    },
    flows: {
      start: async (value) => {
        calls.push(["persist", value]);
        return row;
      }
    }
  };
  const input = {
    host,
    networkDigest: "a".repeat(64),
    cookieHeader: undefined,
    fields: {
      identifier: " Synthetic@Example.test ",
      clientFlowNonce: randomBytes(32).toString("base64url"),
      requestDigest: "b".repeat(64),
      digestPolicyVersion: "FIPS202-SHA3-256-DOMAIN-SEPARATED-V1",
      returnTo: "/materials"
    }
  };
  return { calls, entry, row, options, input, run: () => createTenantLoginStart(options)(input) };
}
test("start charges independent budgets before persisting, with random server bearer and keyed identifiers", async () => {
  const f = fixture(),
    result = await f.run();
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["rate", "persist"]
  );
  assert.equal(result.next, "PASSWORD");
  assert.match(result.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(result.secret, f.input.fields.clientFlowNonce);
  const persisted = f.calls[1][1];
  assert.equal(JSON.stringify(persisted).includes("Synthetic"), false);
  assert.equal(JSON.stringify(persisted).includes(result.secret), false);
  const expected = createHmac("sha3-256", key.bytes)
    .update(
      frameDigestPayload(
        "authentication-flow",
        Buffer.from(
          JSON.stringify({ environment: "staging", realm: "TENANT", value: result.secret })
        )
      )
    )
    .digest("hex");
  assert.equal(persisted.flowSecretDigest, expected);
  assert.equal(persisted.tenantId, tenantId);
  assert.equal(f.calls[0][1].budgets.length, 3);
});
test("replay never recovers or replaces a bearer; missing original cookie requires explicit restart", async () => {
  const f = fixture();
  f.row.created = false;
  f.row.proofMatches = false;
  const result = await f.run();
  assert.equal(result.flowId, tenantId);
  assert.equal(result.next, "RESTART_REQUIRED");
  assert.equal(result.secret, undefined);
  f.row.proofMatches = true;
  f.input.cookieHeader = `__Host-noxos-auth=${randomBytes(32).toString("base64url")}`;
  const replay = await f.run();
  assert.equal(replay.next, "PASSWORD");
  assert.equal(replay.secret, undefined);
  f.row.state = "SESSION_ISSUED";
  assert.equal((await f.run()).next, "ORIGINAL_RESULT");
  f.row.expiresAt = new Date(0);
  assert.equal((await f.run()).next, "RESTART_REQUIRED");
});
test("unknown host, malformed proof, unsafe return and missing budget cannot persist", async () => {
  for (const change of [
    (f) => (f.options.resolveEntry = async () => null),
    (f) => (f.input.cookieHeader = "__Host-noxos-auth=bad"),
    (f) => (f.input.fields.returnTo = "//evil.test"),
    (f) => delete f.entry.budgets.NETWORK,
    (f) => (f.input.networkDigest = ""),
    (f) => (f.input.fields.providerMethod = "SOCIAL")
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 0);
  }
});
test("rate denial and store outage do not create flow or call provider", async () => {
  for (const failure of ["THROTTLED", "OUTAGE"]) {
    const f = fixture();
    f.options.rate.consume = async () => {
      if (failure === "OUTAGE") throw Error("offline");
      return failure;
    };
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 0);
  }
});
test("a new start never reuses the previous flow cookie as its new bearer", async () => {
  const f = fixture(),
    old = randomBytes(32).toString("base64url");
  f.input.cookieHeader = `__Host-noxos-auth=${old}`;
  const result = await f.run(),
    saved = f.calls[1][1];
  assert.notEqual(result.secret, old);
  assert.match(saved.existingFlowSecretDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(saved.existingFlowSecretDigest, saved.flowSecretDigest);
});

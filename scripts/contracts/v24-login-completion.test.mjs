import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createTenantLoginCompletion } from "../../apps/nox-os/server/tenant-login-completion.ts";
import { createTenantLoginHttp } from "../../apps/nox-os/server/tenant-login-http.ts";

const key = { version: "test-v1", environment: "staging", bytes: randomBytes(32) };
const flowId = "11111111-1111-4111-8111-111111111111";
const input = {
  host: "staging.example.test",
  cookieHeader: `__Host-noxos-auth=${randomBytes(32).toString("base64url")}`,
  networkDigest: "c".repeat(64),
  fields: {
    flowId,
    identifier: "Synthetic@Example.test",
    password: "test-only-transient-password",
    operationKey: randomBytes(32).toString("base64url"),
    requestDigest: "d".repeat(64)
  }
};
function fixture() {
  const calls = [];
  let state = "INITIATED",
    binding,
    row = null;
  const options = {
    key,
    async resolveEntry(host) {
      calls.push("entry");
      return host === input.host
        ? {
            tenantId: "22222222-2222-4222-8222-222222222222",
            routingVersion: 1,
            policyVersion: "policy:1",
            ratePolicyRef: "rate-v1",
            budgets: Object.fromEntries(
              ["FLOW", "IDENTIFIER", "NETWORK", "SUBJECT"].map((dimension) => [
                dimension,
                { limit: 5, windowSeconds: 60 }
              ])
            )
          }
        : null;
    },
    flows: {
      async readCurrent(scope) {
        calls.push("read");
        if (!row)
          row = {
            id: flowId,
            state,
            routing_version: 1,
            policy_version: "policy:1",
            token_digest_key_version: key.version,
            identifier_correlation_digest: scope.identifierDigest,
            expires_at: new Date(Date.now() + 900000),
            complete_operation_digest: null,
            complete_request_digest: null
          };
        return { ...row, state };
      },
      async claimProvider(scope) {
        calls.push("claim");
        if (binding) {
          if (
            binding.operationDigest !== scope.operationDigest ||
            binding.completionDigest !== scope.completionDigest
          )
            throw Error("AUTH_COMPLETION_REPLAY_CONFLICT");
          return null;
        }
        binding = scope;
        row.complete_operation_digest = scope.operationDigest;
        row.complete_request_digest = scope.completionDigest;
        state = "PENDING_RECONCILIATION";
        return { operationId: "33333333-3333-4333-8333-333333333333" };
      },
      async recordProvider({ result }) {
        calls.push(`record:${result.kind}`);
        state = result.kind === "VERIFIED" ? "PRIMARY_VERIFIED" : "FAILED_GENERIC";
        return true;
      }
    },
    rate: {
      async consume(value) {
        calls.push(`rate:${value.phase}`);
        return "ALLOW";
      }
    },
    provider: {
      async verifyPassword(value) {
        calls.push("provider");
        assert.equal(value.identifier, "synthetic@example.test");
        return {
          kind: "VERIFIED",
          environment: "staging",
          providerKey: "supabase",
          issuer: "https://uyfddpmbszjkhdkqvncz.supabase.co/auth/v1",
          subject: flowId,
          providerSessionId: "33333333-3333-4333-8333-333333333333",
          assurance: "A1",
          verifiedAt: Date.now()
        };
      }
    },
    async commitWithCurrentAuthority(scope) {
      calls.push("commit");
      assert.equal(scope.tenantId, "22222222-2222-4222-8222-222222222222");
      state = "SESSION_ISSUED";
      return {
        kind: "ISSUED",
        secret: randomBytes(32).toString("base64url"),
        absoluteExpiresAt: Date.now() + 3600000
      };
    },
    async recordSecurityEvent(event) {
      calls.push(`event:${event.result}`);
      assert.equal(JSON.stringify(event).includes(input.fields.password), false);
      assert.equal(JSON.stringify(event).includes(input.fields.identifier), false);
      assert.equal(JSON.stringify(event).includes(input.cookieHeader), false);
    }
  };
  return {
    options,
    calls,
    complete: (value = input) => createTenantLoginCompletion(options)(value)
  };
}

test("completion claims before credentials and charges subject before recording verified proof", async () => {
  const f = fixture();
  assert.equal((await f.complete()).kind, "ISSUED");
  assert.deepEqual(f.calls, [
    "entry",
    "read",
    "rate:BEFORE_PROVIDER",
    "claim",
    "provider",
    "rate:VERIFIED_SUBJECT",
    "record:VERIFIED",
    "event:PRIMARY_VERIFIED",
    "commit"
  ]);
  assert.equal((await f.complete()).kind, "ORIGINAL_RESULT");
  assert.equal(f.calls.filter((x) => x === "provider").length, 1);
  assert.equal(f.calls.filter((x) => x === "commit").length, 1);
});

test("unknown provider result never retries credentials or reaches session commit", async () => {
  const f = fixture();
  f.options.provider.verifyPassword = async () => {
    f.calls.push("provider");
    throw Error("uncertain provider side effect");
  };
  assert.equal((await f.complete()).kind, "PENDING_RECONCILIATION");
  assert.equal((await f.complete()).kind, "PENDING_RECONCILIATION");
  assert.equal(f.calls.filter((x) => x === "provider").length, 1);
  assert.equal(f.calls.includes("commit"), false);
});

test("missing edge identity, invalid cookie and unknown host never call provider", async () => {
  for (const patch of [
    { networkDigest: "" },
    { cookieHeader: undefined },
    { cookieHeader: `${input.cookieHeader}; ${input.cookieHeader}` },
    { host: "other.example.test" }
  ]) {
    const f = fixture();
    await assert.rejects(f.complete({ ...input, ...patch }));
    assert.equal(f.calls.includes("provider"), false);
  }
});

test("rate denial and rate outage cannot bypass budgets on retry", async () => {
  for (const phase of ["BEFORE_PROVIDER", "VERIFIED_SUBJECT"]) {
    const f = fixture();
    f.options.rate.consume = async (value) => (value.phase === phase ? "THROTTLED" : "ALLOW");
    assert.equal((await f.complete()).kind, "DENIED");
    assert.equal((await f.complete()).kind, "DENIED");
    assert.equal(f.calls.includes("commit"), false);
  }
  const f = fixture();
  f.options.rate.consume = async ({ phase }) => {
    if (phase === "VERIFIED_SUBJECT") throw Error("storage unavailable");
    return "ALLOW";
  };
  await assert.rejects(f.complete());
  assert.equal((await f.complete()).kind, "PENDING_RECONCILIATION");
  assert.equal(f.calls.filter((x) => x === "provider").length, 1);
  assert.equal(f.calls.includes("commit"), false);
});

test("changed replay, stale routing, audit failure and unavailable current authority fail closed", async () => {
  const f = fixture();
  await f.complete();
  await assert.rejects(
    f.complete({ ...input, fields: { ...input.fields, requestDigest: "e".repeat(64) } })
  );
  for (const boundary of ["routing", "audit", "authority"]) {
    const next = fixture();
    if (boundary === "routing")
      next.options.flows.readCurrent = async () => ({ routing_version: 2 });
    if (boundary === "audit")
      next.options.recordSecurityEvent = async () => {
        throw Error("audit unavailable");
      };
    if (boundary === "authority")
      next.options.commitWithCurrentAuthority = async () => {
        throw Error("current role/risk unknown");
      };
    await assert.rejects(next.complete());
    if (boundary !== "authority") assert.equal(next.calls.includes("commit"), false);
  }
});

test("HTTP completion reaches the coordinator without exposing provider credentials or scope", async () => {
  const f = fixture();
  const fields = { ...input.fields, digestPolicyVersion: "FIPS202-SHA3-256-DOMAIN-SEPARATED-V1" };
  const bytes = Buffer.from(
    JSON.stringify({
      digestPolicyVersion: fields.digestPolicyVersion,
      flowId,
      identifier: fields.identifier,
      operationKey: fields.operationKey
    })
  );
  const size = Buffer.alloc(8);
  size.writeBigUInt64BE(BigInt(bytes.length));
  fields.requestDigest = createHash("sha3-256")
    .update(Buffer.concat([Buffer.from("noxos:v1:tenant-login-complete\0"), size, bytes]))
    .digest("hex");
  const handler = createTenantLoginHttp({
    returnPaths: ["/materials"],
    service: {
      isActiveTenantHost: async (host) => host === input.host,
      start: async () => {
        throw Error("not this test's surface");
      },
      complete: (value) => f.complete({ ...value, networkDigest: input.networkDigest })
    }
  });
  const response = await handler(
    new Request(`https://${input.host}/api/auth/tenant/login/complete`, {
      method: "POST",
      headers: {
        origin: `https://${input.host}`,
        "content-type": "application/json",
        cookie: input.cookieHeader,
        "x-role": "OWNER",
        "x-tenant-id": "forged"
      },
      body: JSON.stringify(fields)
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "AUTHENTICATED" });
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(f.calls.filter((x) => x === "provider").length, 1);
});

test("concurrent completion has one provider effect and one winner", async () => {
  const f = fixture();
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const verify = f.options.provider.verifyPassword;
  f.options.provider.verifyPassword = async (value) => {
    await barrier;
    return verify(value);
  };
  const first = f.complete(),
    second = f.complete();
  release();
  const outcomes = await Promise.all([first, second]);
  assert.equal(outcomes.filter((x) => x.kind === "ISSUED").length, 1);
  assert.equal(f.calls.filter((x) => x === "provider").length, 1);
  assert.equal(f.calls.filter((x) => x === "commit").length, 1);
});

test("an audit outage remains retryable without repeating credentials", async () => {
  const f = fixture();
  const audit = f.options.recordSecurityEvent;
  f.options.recordSecurityEvent = async () => {
    throw Error("audit unavailable");
  };
  await assert.rejects(f.complete());
  assert.equal(f.calls.includes("commit"), false);
  f.options.recordSecurityEvent = audit;
  assert.equal((await f.complete()).kind, "ISSUED");
  assert.equal(f.calls.filter((x) => x === "provider").length, 1);
  await assert.rejects(
    f.complete({ ...input, fields: { ...input.fields, identifier: "different@example.test" } })
  );
});

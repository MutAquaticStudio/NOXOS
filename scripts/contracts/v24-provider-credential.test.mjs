import test from "node:test";
import assert from "node:assert/strict";
import { readSupabaseCredentialState } from "../../packages/database/src/provider-credential-state.ts";
const flowId = "11111111-1111-4111-8111-111111111111";
test("credential read uses the supplied transaction and an opaque parameter, never a native credential", async () => {
  let calls = 0;
  const tx = async (strings, ...values) => {
    calls++;
    assert.deepEqual(values, [flowId]);
    assert.match(strings.join("?"), /read_auth_flow_credential_state/);
    return [{ state: "CURRENT" }];
  };
  assert.equal(await readSupabaseCredentialState(tx, flowId), "CURRENT");
  assert.equal(calls, 1);
});
test("revoked and unknown provider state stay denied facts, missing/ambiguous/outage never become current", async () => {
  for (const state of ["REVOKED", "UNKNOWN"])
    assert.equal(await readSupabaseCredentialState(async () => [{ state }], flowId), state);
  for (const rows of [[], [{ state: "CURRENT" }, { state: "CURRENT" }], [{ state: "HEALTHY" }]])
    await assert.rejects(
      readSupabaseCredentialState(async () => rows, flowId),
      /AUTH_CURRENT_AUTHORITY_UNAVAILABLE/
    );
  await assert.rejects(
    readSupabaseCredentialState(async () => {
      throw Error("offline");
    }, flowId),
    /offline/
  );
  await assert.rejects(
    readSupabaseCredentialState(async () => assert.fail("must not query"), "not-a-flow"),
    /AUTH_FLOW_UNAVAILABLE/
  );
});

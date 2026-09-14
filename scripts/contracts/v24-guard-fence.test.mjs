import test from "node:test";
import assert from "node:assert/strict";
import {
  orderedGuardRequirements,
  acquireGuardFences
} from "../../packages/database/src/guard-fence.ts";
const base = {
  scope: "TENANT",
  tenantId: "11111111-1111-4111-8111-111111111111",
  ownerGate: "G2",
  objectType: "session",
  objectId: "a",
  mode: "SHARED"
};
test("guard set orders complete tuples and requests strongest mode before locking", () => {
  const values = orderedGuardRequirements([
    { ...base, objectId: "b" },
    base,
    { ...base, mode: "EXCLUSIVE" }
  ]);
  assert.deepEqual(
    values.map((x) => [x.objectId, x.mode]),
    [
      ["a", "EXCLUSIVE"],
      ["b", "SHARED"]
    ]
  );
  assert.ok(Object.isFrozen(values[0]));
});
test("invalid scope/tenant or unknown lock mode fails before any query", async () => {
  for (const patch of [
    { tenantId: null },
    { scope: "UNKNOWN" },
    { mode: "READ" },
    { ownerGate: "G16" },
    { objectType: "" }
  ]) {
    let called = false;
    await assert.rejects(() =>
      acquireGuardFences(async () => {
        called = true;
        return [];
      }, [{ ...base, ...patch }])
    );
    assert.equal(called, false);
  }
});
test("acquisition uses same transaction, ordered parameterized SQL, no missing-row insertion", async () => {
  const calls = [];
  const tx = async (strings, ...values) => {
    calls.push({ sql: strings.join("?"), values });
    return [{ epoch: "9007199254740993" }];
  };
  const output = await acquireGuardFences(tx, [
    { ...base, objectId: "b" },
    { ...base, mode: "EXCLUSIVE" }
  ]);
  assert.deepEqual(
    calls.map((c) => c.values.at(-1)),
    ["a", "b"]
  );
  assert.match(calls[0].sql, /for update$/);
  assert.match(calls[1].sql, /for share$/);
  assert.equal(output[0].epoch, "9007199254740993");
  await assert.rejects(() => acquireGuardFences(async () => [], [base]), /UNKNOWN_REQUIRED_GUARD/);
});

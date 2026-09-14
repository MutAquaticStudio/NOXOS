import test from "node:test";
import assert from "node:assert/strict";
import { createAuthRateStore } from "../../packages/database/dist/auth-rate-store.js";

const request = {
  environment: "staging",
  realm: "TENANT",
  policyRef: "test-v1",
  keyVersion: "test-key",
  phase: "BEFORE_PROVIDER",
  budgets: ["FLOW", "IDENTIFIER", "NETWORK"].map((dimension) => ({
    dimension,
    digest: "a".repeat(64),
    limit: 5,
    windowSeconds: 60
  }))
};
test("missing or invalid independent budgets fail closed before SQL", async () => {
  let calls = 0;
  const store = createAuthRateStore({
    begin() {
      calls++;
      throw Error("SQL_MUST_NOT_RUN");
    }
  });
  for (const patch of [
    { budgets: [] },
    { budgets: request.budgets.slice(1) },
    { phase: "unknown" },
    { environment: "preview" },
    { realm: "ADMIN" },
    { policyRef: "" },
    { keyVersion: "" },
    { budgets: [...request.budgets, request.budgets[0]] },
    ...[
      { limit: 0 },
      { limit: 1.5 },
      { windowSeconds: 0 },
      { windowSeconds: 3601 },
      { digest: "raw@email.test" }
    ].map((patch) => ({ budgets: request.budgets.map((b) => ({ ...b, ...patch })) }))
  ])
    await assert.rejects(
      store.consume({ ...request, ...patch }),
      /AUTH_RATE_CONFIGURATION_UNAVAILABLE/
    );
  assert.equal(calls, 0);
});
test("database outage is never converted to an allowed rate decision", async () => {
  const store = createAuthRateStore({
    async begin() {
      throw Error("DATABASE_UNAVAILABLE");
    }
  });
  await assert.rejects(store.consume(request), /DATABASE_UNAVAILABLE/);
});

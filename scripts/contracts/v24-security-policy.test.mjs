import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveLoginPolicy,
  resolveCurrentLoginAssurance
} from "../../packages/auth/src/security-policy.ts";

const floor = {
  required_assurance_by_action: { TENANT_LOGIN: "A1", OWNER_TRANSFER: "A2" },
  idle_seconds: 1800,
  absolute_seconds: 43200,
  step_up_seconds: 300,
  recovery_token_seconds: 900,
  privileged_max_seconds: 1800,
  allowed_authenticator_classes: ["PASSWORD", "PASSKEY"],
  rate_policy_ref: "rate-v1",
  detection_policy_ref: "detection-v1"
};

test("floor and explicit tightening produce immutable login limits", () => {
  assert.deepEqual(resolveLoginPolicy(floor), {
    requiredRank: 1,
    idleSeconds: 1800,
    absoluteSeconds: 43200
  });
  const result = resolveLoginPolicy(floor, {
    ...floor,
    required_assurance_by_action: { TENANT_LOGIN: "A2", OWNER_TRANSFER: "A2" },
    idle_seconds: 600,
    absolute_seconds: 3600,
    allowed_authenticator_classes: ["PASSKEY"]
  });
  assert.equal(result.requiredRank, 2);
  assert.equal(result.idleSeconds, 600);
  assert.equal(Object.isFrozen(result), true);
});

test("every timeout and every protected action must preserve the floor", () => {
  for (const field of [
    "idle_seconds",
    "absolute_seconds",
    "step_up_seconds",
    "recovery_token_seconds",
    "privileged_max_seconds"
  ])
    assert.throws(
      () => resolveLoginPolicy(floor, { ...floor, [field]: floor[field] + 1 }),
      /AUTH_POLICY_INVALID/
    );
  for (const changes of [
    { OWNER_TRANSFER: "A1", TENANT_LOGIN: "A1" },
    { TENANT_LOGIN: "A2" },
    { ...floor.required_assurance_by_action, OWNER_TRANSFER: "UNKNOWN" }
  ])
    assert.throws(
      () => resolveLoginPolicy(floor, { ...floor, required_assurance_by_action: changes }),
      /AUTH_POLICY_INVALID/
    );
});

test("unknown factors or incomparable rate/detection policies fail closed", () => {
  for (const patch of [
    { allowed_authenticator_classes: ["PASSWORD", "PASSKEY", "WEAKER"] },
    { allowed_authenticator_classes: [] },
    { rate_policy_ref: "unverified-rate" },
    { detection_policy_ref: "disabled-notifications" }
  ])
    assert.throws(() => resolveLoginPolicy(floor, { ...floor, ...patch }), /AUTH_POLICY_INVALID/);
});

test("malformed floor does not become a permissive default", () => {
  for (const patch of [
    { required_assurance_by_action: {} },
    { required_assurance_by_action: { TENANT_LOGIN: "toString" } },
    { required_assurance_by_action: [] },
    { idle_seconds: 0 },
    { absolute_seconds: 600 },
    { step_up_seconds: NaN },
    { recovery_token_seconds: 1.5 },
    { allowed_authenticator_classes: [null] },
    { rate_policy_ref: "" }
  ])
    assert.throws(() => resolveLoginPolicy({ ...floor, ...patch }), /AUTH_POLICY_INVALID/);
});

const current = {
  protectedRole: null,
  risk: "ALLOW_BASELINE",
  credentialState: "CURRENT",
  destinationAssurance: "A1",
  detectionPolicyRef: "detection-v1"
};
test("Owner, destination and risk can tighten but never weaken login assurance", () => {
  assert.equal(resolveCurrentLoginAssurance(1, "A1", current, "detection-v1"), 1);
  assert.equal(
    resolveCurrentLoginAssurance(
      1,
      "A1",
      { ...current, protectedRole: "TENANT_OWNER" },
      "detection-v1"
    ),
    2
  );
  assert.equal(
    resolveCurrentLoginAssurance(1, "A1", { ...current, risk: "STEP_UP" }, "detection-v1"),
    2
  );
  assert.equal(
    resolveCurrentLoginAssurance(
      1,
      "A1",
      { ...current, destinationAssurance: "PHISHING_RESISTANT" },
      "detection-v1"
    ),
    3
  );
  assert.equal(resolveCurrentLoginAssurance(3, "A1", current, "detection-v1"), 3);
  assert.equal(resolveCurrentLoginAssurance(1, "A2", current, "detection-v1"), 2);
});

test("missing, stale, cross-realm and unknown current authority never means A1", () => {
  for (const patch of [
    { protectedRole: undefined },
    { protectedRole: "PLATFORM_OWNER" },
    { credentialState: "UNKNOWN" },
    { credentialState: "REVOKED" },
    { risk: "THROTTLE" },
    { risk: "BLOCK_GENERIC" },
    { risk: "MANUAL_REVIEW" },
    { risk: "UNKNOWN" },
    { risk: "toString" },
    { risk: undefined },
    { destinationAssurance: "UNKNOWN" },
    { detectionPolicyRef: "old-version" }
  ])
    assert.throws(() =>
      resolveCurrentLoginAssurance(1, "A1", { ...current, ...patch }, "detection-v1")
    );
  for (const rank of [0, 4, NaN, 1.5])
    assert.throws(() => resolveCurrentLoginAssurance(rank, "A1", current, "detection-v1"));
  assert.throws(() => resolveCurrentLoginAssurance(1, "UNKNOWN", current, "detection-v1"));
  assert.throws(() => resolveCurrentLoginAssurance(1, "A1", null, "detection-v1"));
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

describe("G2 Staging acceptance-fixture boundary", () => {
  it("keeps the foundation test module outside the canonical registry", () => {
    expect(moduleDefinitions.map((definition) => definition.descriptor.id)).not.toContain(
      "foundation-test"
    );
  });

  it("loads the test-only module only for explicit Staging acceptance", () => {
    const handler = readFileSync("apps/nox-os/api/v1/[...route].ts", "utf8");
    const deployment = readFileSync("scripts/deploy/staging.ts", "utf8");

    expect(handler).toContain('process.env.NOX_ENV === "staging"');
    expect(handler).toContain('process.env.NOX_G2_TEST_MODE === "true"');
    expect(deployment).toContain('"NOX_G2_TEST_MODE=true"');
    expect(deployment).toContain('"NOX_FEATURE_FLAGS=module.foundation-test"');
  });

  it("uses deterministic per-fixture cleanup for the protected Staging suite", () => {
    const verifier = readFileSync("scripts/verify/staging-g2-platform-core.ts", "utf8");

    expect(verifier).not.toContain("transaction.array(");
    expect(verifier).toContain("delete from platform.audit_events where actor_user_id = ${userId}");
    expect(verifier).toContain("delete from platform.tenants where id = ${tenantId}");
    expect(verifier).toContain("G2 Staging database fixture cleanup failed.");
  });
});

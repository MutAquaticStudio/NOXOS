import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveDefinitionAvailability } from "@nox-os/module-registry";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

describe("Release Readiness module contract", () => {
  const definition = moduleDefinitions.find((item) => item.descriptor.id === "release-readiness")!;

  it("owns one canonical route, API namespace, entitlement and permission manifest", () => {
    expect(definition.descriptor).toMatchObject({
      routeRoot: "/release-readiness",
      apiNamespace: "release-readiness",
      entitlement: "module.release-readiness",
      featureFlag: "module.release-readiness",
      lifecycle: "INTERNAL"
    });
    expect(definition.authorization.permissions).toEqual([
      "module.release-readiness.assessment.read",
      "module.release-readiness.assessment.create",
      "module.release-readiness.assessment.run",
      "module.release-readiness.assessment.review"
    ]);
  });

  it("fails closed on flag, entitlement, and permission independently", () => {
    const base = {
      featureFlags: new Set(["module.release-readiness"]),
      entitlements: new Set(["module.release-readiness"]),
      permissions: new Set(["module.release-readiness.assessment.read"])
    };
    expect(resolveDefinitionAvailability(definition, base).state).toBe("AVAILABLE");
    expect(
      resolveDefinitionAvailability(definition, { ...base, featureFlags: new Set() }).state
    ).toBe("DISABLED");
    expect(
      resolveDefinitionAvailability(definition, { ...base, entitlements: new Set() }).state
    ).toBe("NOT_ENTITLED");
    expect(
      resolveDefinitionAvailability(definition, { ...base, permissions: new Set() }).state
    ).toBe("NO_PERMISSION");
  });

  it("keeps the G6 experience as the single runtime renderer", () => {
    const appSource = readFileSync("apps/nox-os/src/app.tsx", "utf8");
    expect(appSource).toContain('definition.descriptor.id !== "release-readiness"');
    expect(appSource).toContain('path="/release-readiness/*"');
  });
});

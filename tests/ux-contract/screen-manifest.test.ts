import { describe, expect, it } from "vitest";
import {
  gateUiManifestSchema,
  validateScreenManifestCoverage
} from "../../packages/contracts/src/ui-manifest";
import { formulaDetailUiManifest } from "../../apps/nox-os/src/modules/design-studio-ui-manifest";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";
import { releaseRegistryUiManifest } from "../../apps/nox-os/src/modules/release-registry-ui-manifest";
import {
  releaseCreateUiManifest,
  releaseDetailUiManifest
} from "../../apps/nox-os/src/modules/release-assessment-ui-manifests";

describe("DESIGN §92 manifest contract", () => {
  it("maps every registered G6 route exactly once, without claiming pending acceptance", () => {
    const descriptor = moduleDefinitions.find(
      (module) => module.descriptor.id === "release-readiness"
    )!.descriptor;
    const manifests = [releaseRegistryUiManifest, releaseCreateUiManifest, releaseDetailUiManifest];
    const routes = [descriptor.routeRoot, ...descriptor.childRoutes!];
    expect(manifests.map((manifest) => manifest.route).sort()).toEqual([...routes].sort());
    const runtime = routes.map((route) => ({
      route,
      screenId:
        route === descriptor.routeRoot
          ? "release-readiness.registry"
          : route.endsWith("/new")
            ? "release-readiness.create"
            : "release-readiness.detail"
    }));
    expect(validateScreenManifestCoverage(runtime, manifests, false)).toEqual([]);
    expect(validateScreenManifestCoverage(runtime, manifests)).toHaveLength(3);
    for (const manifest of manifests)
      expect(gateUiManifestSchema.safeParse(manifest).success).toBe(true);
    for (const manifest of [releaseCreateUiManifest, releaseDetailUiManifest]) {
      expect(gateUiManifestSchema.safeParse({ ...manifest, status: "READY" }).success).toBe(false);
      const mutation = manifest.commands.find((command) => command.kind === "mutation")!;
      expect(mutation.idempotency.mode).toBe("keyed-server-replay");
      expect(mutation.auditEventRef).toContain("release-readiness");
    }
  });
  it("binds the G6 read registry only, without certifying create or reassessment", () => {
    expect(
      moduleDefinitions.find((module) => module.descriptor.id === "release-readiness")?.descriptor
        .routeRoot
    ).toBe(releaseRegistryUiManifest.route);
    expect(gateUiManifestSchema.safeParse(releaseRegistryUiManifest).success).toBe(true);
    expect(releaseRegistryUiManifest.commands.every((command) => command.kind === "read")).toBe(
      true
    );
    expect(
      validateScreenManifestCoverage([releaseRegistryUiManifest], [releaseRegistryUiManifest])
    ).toEqual(["Screen not READY: release-readiness.registry"]);
  });
  it("binds DS-04 to its actual registered route without certifying missing domain evidence", () => {
    expect(
      moduleDefinitions.find((module) => module.descriptor.id === "design-studio")?.descriptor
        .childRoutes
    ).toContain(formulaDetailUiManifest.route);
    expect(gateUiManifestSchema.safeParse(formulaDetailUiManifest).success).toBe(true);
    expect(
      validateScreenManifestCoverage([formulaDetailUiManifest], [formulaDetailUiManifest], false)
    ).toEqual([]);
    expect(
      validateScreenManifestCoverage([formulaDetailUiManifest], [formulaDetailUiManifest])
    ).toEqual(["Screen not READY: DS-04"]);
  });
  it("rejects blanket READY with unresolved concerns", () => {
    expect(
      gateUiManifestSchema.safeParse({ ...formulaDetailUiManifest, status: "READY" }).success
    ).toBe(false);
  });
  it.each([
    "targetVersionSource",
    "guardRefs",
    "auditEventRef",
    "successStateSource",
    "idempotency",
    "confirmation"
  ])("rejects mutation missing %s", (field) => {
    const input = structuredClone(formulaDetailUiManifest);
    const command = input.commands.find((command) => command.kind === "mutation")!;
    Reflect.deleteProperty(command, field);
    expect(gateUiManifestSchema.safeParse(input).success).toBe(false);
  });
  it("rejects wildcard permissions and unsupported interaction", () => {
    expect(
      gateUiManifestSchema.safeParse({
        ...formulaDetailUiManifest,
        routeAccess: { ...formulaDetailUiManifest.routeAccess, readPermission: "*" }
      }).success
    ).toBe(false);
    expect(
      gateUiManifestSchema.safeParse({
        ...formulaDetailUiManifest,
        interaction: {
          ...formulaDetailUiManifest.interaction,
          supported: ["pointer"],
          default: "touch"
        }
      }).success
    ).toBe(false);
  });
  it("rejects missing, orphaned and duplicate mappings", () => {
    expect(validateScreenManifestCoverage([formulaDetailUiManifest], [], false)).toContain(
      "Expected exactly one matching manifest: DS-04"
    );
    expect(validateScreenManifestCoverage([], [formulaDetailUiManifest], false)).toContain(
      "Manifest has no runtime entry: DS-04"
    );
    expect(
      validateScreenManifestCoverage(
        [formulaDetailUiManifest],
        [formulaDetailUiManifest, formulaDetailUiManifest],
        false
      )
    ).toContain("Expected exactly one matching manifest: DS-04");
  });
  it("requires explicit distinct selectors for shared routes", () => {
    const a = {
      ...formulaDetailUiManifest,
      screenId: "fixture-a",
      routeStateSelector: { canonicalSource: "canonical state", value: "A" }
    };
    const b = {
      ...a,
      screenId: "fixture-b",
      routeStateSelector: { canonicalSource: "canonical state", value: "B" }
    };
    expect(validateScreenManifestCoverage([a, b], [a, b], false)).toEqual([]);
    const ambiguous = { ...b, routeStateSelector: a.routeStateSelector };
    expect(validateScreenManifestCoverage([a, ambiguous], [a, ambiguous], false)).toContain(
      `Ambiguous runtime route/state: ${a.route}`
    );
    const parallel = { ...b, routeStateSelector: { canonicalSource: "client guess", value: "B" } };
    expect(validateScreenManifestCoverage([a, parallel], [a, parallel], false)).toContain(
      `Shared route requires one deterministic selector source: ${a.route}`
    );
  });
});

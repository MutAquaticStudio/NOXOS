import { describe, expect, it } from "vitest";
import { tenantSafeCurrentRegulatoryProjection } from "@nox-os/release-readiness";

describe("G6 tenant-safe current regulatory projection", () => {
  const current = {
    displayName: "Private renamed Material",
    materialType: "SINGLE_MOLECULE",
    approvalStatus: "APPROVED",
    sourceMaterialUpdatedAt: "2026-09-01T00:00:00.000Z",
    ifraRestricted: true,
    ifraCat4MaxPct: "0.01",
    ifraLimits: { cat4: "0.01" },
    ifraAmendment: "secret-amendment",
    ifraSourceReference: "secret-reference",
    sourceReference: "secret-source",
    euAllergens: [{ name: "secret-allergen" }]
  };

  it("returns current evidence only while the tenant retains Material access", () => {
    expect(
      tenantSafeCurrentRegulatoryProjection({
        tenantAccessible: true,
        frozenDisplayName: "Frozen Material",
        frozenMaterialType: "NATURAL",
        current
      })
    ).toMatchObject({ displayName: current.displayName, ifraCat4MaxPct: "0.01" });
  });

  it("falls back to frozen identity and removes all inaccessible current evidence", () => {
    const projection = tenantSafeCurrentRegulatoryProjection({
      tenantAccessible: false,
      frozenDisplayName: "Frozen Material",
      frozenMaterialType: "NATURAL",
      current
    });
    expect(projection).toMatchObject({
      displayName: "Frozen Material",
      materialType: "NATURAL",
      approvalStatus: "INACCESSIBLE",
      currentSourceMaterialUpdatedAt: "UNAVAILABLE",
      ifraCat4MaxPct: null,
      ifraLimits: {},
      euAllergens: []
    });
    expect(JSON.stringify(projection)).not.toContain("secret");
  });
});

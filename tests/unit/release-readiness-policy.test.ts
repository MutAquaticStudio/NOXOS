import { describe, expect, it } from "vitest";
import {
  KnownLimitV1Policy,
  aggregateReleaseDecision,
  compareActiveExposureToLimit,
  type ReleaseCheckResult
} from "@nox-os/release-readiness";
import { g6Evidence, g6MaterialEvidence } from "../helpers/g6-release-fixture";

const policy = new KnownLimitV1Policy();
const profile = {
  formulaVersionId: "84000000-0000-4000-8000-000000000001",
  applicationKey: "fine-fragrance",
  dosagePct: 10,
  policyKey: "g6-known-limit-v1" as const
};

function evaluate(material = g6MaterialEvidence(), applicationKey = "fine-fragrance") {
  const checks = policy.evaluate({
    profile: { ...profile, applicationKey },
    evidence: g6Evidence(undefined, { materials: [material] })
  });
  return { checks, decision: aggregateReleaseDecision(checks) };
}

describe("G6 deterministic known-limit policy", () => {
  it("compares one exact representable unit below, at, and above the boundary", () => {
    const values = ["99999", "100000", "100001"].map(
      (activeAromaticMassMg) =>
        compareActiveExposureToLimit({
          activeAromaticMassMg,
          referenceFormulaMassMg: "1000000",
          dosagePct: 10,
          limitPct: 1
        }).comparison
    );
    expect(values).toEqual([-1, 0, 1]);
  });

  it("returns READY exactly at the limit with complete provenance", () => {
    const result = evaluate();
    expect(result.decision).toBe("READY");
    expect(result.checks.find((item) => item.checkKey === "KNOWN_LIMIT")?.result).toBe("PASS");
  });

  it("returns BLOCKED above the limit", () => {
    const result = evaluate(g6MaterialEvidence({ activeAromaticMassMg: "100001" }));
    expect(result.decision).toBe("BLOCKED");
  });

  it("uses dilution active mass and excludes carrier solvent mass", () => {
    const result = evaluate(
      g6MaterialEvidence({
        materialType: "DILUTION",
        activeAromaticMassMg: "100000",
        carrierSolventMassMg: "900000"
      })
    );
    const check = result.checks.find((item) => item.checkKey === "KNOWN_LIMIT");
    expect(check?.result).toBe("PASS");
    expect(check?.evidence.finishedActivePct).toBe("1");
  });

  it("requires review for missing, conflicting, or incomplete restricted evidence", () => {
    const missing = evaluate(
      g6MaterialEvidence({
        ifraCat4MaxPct: null,
        ifraAmendment: null,
        ifraSourceReference: null,
        sourceReference: null
      })
    );
    expect(missing.decision).toBe("REVIEW_REQUIRED");
    expect(missing.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkKey: "KNOWN_LIMIT", result: "REVIEW" }),
        expect.objectContaining({ checkKey: "REGULATORY_EVIDENCE_COMPLETENESS", result: "REVIEW" })
      ])
    );
    expect(evaluate(g6MaterialEvidence({ ifraLimits: { cat4: 2 } })).decision).toBe(
      "REVIEW_REQUIRED"
    );
    expect(
      evaluate(g6MaterialEvidence({ ifraSourceReference: null, sourceReference: null })).decision
    ).toBe("REVIEW_REQUIRED");
  });

  it("accepts numerically equal direct and canonical map evidence", () => {
    expect(evaluate(g6MaterialEvidence({ ifraLimits: { CAT_4: "1.0" } })).decision).toBe("READY");
  });

  it("fails closed on recognized nonnumeric Category 4 evidence", () => {
    for (const value of [true, false, null, ""] as const) {
      const result = evaluate(
        g6MaterialEvidence({
          ifraCat4MaxPct: null,
          ifraRestricted: false,
          ifraLimits: { cat4: value }
        })
      );
      expect(result.decision).toBe("REVIEW_REQUIRED");
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ checkKey: "KNOWN_LIMIT", result: "REVIEW" })
        ])
      );
    }
  });

  it("does not treat an unproven default non-restricted flag as complete evidence", () => {
    const result = evaluate(
      g6MaterialEvidence({
        ifraRestricted: false,
        ifraCat4MaxPct: null,
        ifraAmendment: null,
        ifraSourceReference: null,
        sourceReference: null
      })
    );
    expect(result.decision).toBe("REVIEW_REQUIRED");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkKey: "KNOWN_LIMIT", result: "PASS" }),
        expect.objectContaining({
          checkKey: "REGULATORY_EVIDENCE_COMPLETENESS",
          result: "REVIEW"
        })
      ])
    );
  });

  it("returns REVIEW_REQUIRED for unsupported applications without guessing", () => {
    expect(evaluate(g6MaterialEvidence(), "leave-on-body").decision).toBe("REVIEW_REQUIRED");
  });

  it("blocks a Material that is no longer approved", () => {
    expect(evaluate(g6MaterialEvidence({ approvalStatus: "PENDING_REVIEW" })).decision).toBe(
      "BLOCKED"
    );
  });

  it("uses BLOCK then REVIEW then PASS precedence", () => {
    const check = (result: ReleaseCheckResult["result"]): ReleaseCheckResult => ({
      checkKey: result,
      subjectType: "FORMULA",
      materialId: null,
      result,
      evidence: {},
      message: result
    });
    expect(aggregateReleaseDecision([check("PASS")])).toBe("READY");
    expect(aggregateReleaseDecision([check("PASS"), check("REVIEW")])).toBe("REVIEW_REQUIRED");
    expect(aggregateReleaseDecision([check("REVIEW"), check("BLOCK")])).toBe("BLOCKED");
  });
});

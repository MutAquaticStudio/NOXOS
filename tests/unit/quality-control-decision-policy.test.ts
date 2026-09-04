import { describe, expect, it } from "vitest";
import {
  inspectionOutcome,
  requireReleaseEligibility,
  QualityControlProblem
} from "@nox-os/quality-control";

describe("G10 decision policy", () => {
  it("uses FAIL then REVIEW_REQUIRED then PASS precedence", () => {
    expect(inspectionOutcome(["PASS", "REVIEW_REQUIRED", "FAIL"])).toBe("FAIL");
    expect(inspectionOutcome(["PASS", "REVIEW_REQUIRED"])).toBe("REVIEW_REQUIRED");
    expect(inspectionOutcome(["PASS", "PASS"])).toBe("PASS");
  });

  it.each([
    [{ status: "MISSING" } as const, "QC_RELEASE_READINESS_MISSING"],
    [{ status: "AMBIGUOUS" } as const, "QC_RELEASE_READINESS_AMBIGUOUS"],
    [
      { status: "RESOLVED", assessmentId: "review", decision: "REVIEW_REQUIRED" } as const,
      "QC_RELEASE_NOT_READY"
    ],
    [
      { status: "RESOLVED", assessmentId: "blocked", decision: "BLOCKED" } as const,
      "QC_RELEASE_NOT_READY"
    ]
  ])("fails closed for %o", (readiness, code) => {
    try {
      requireReleaseEligibility({ status: "FINAL", outcome: "PASS" }, readiness);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(QualityControlProblem);
      expect((error as QualityControlProblem).code).toBe(code);
    }
  });

  it("pins only a uniquely resolved current READY assessment", () => {
    expect(
      requireReleaseEligibility(
        { status: "FINAL", outcome: "PASS" },
        { status: "RESOLVED", assessmentId: "current-ready", decision: "READY" }
      ).assessmentId
    ).toBe("current-ready");
    expect(() =>
      requireReleaseEligibility(
        { status: "FINAL", outcome: "REVIEW_REQUIRED" },
        { status: "RESOLVED", assessmentId: "current-ready", decision: "READY" }
      )
    ).toThrowError(/PASS/);
  });
});

import { describe, expect, it } from "vitest";
import { isFinalTrialEvidence } from "@nox-os/trial-sensory";

const trial = {
  id: "trial",
  tenantId: "tenant",
  formulaVersionId: "version",
  status: "COMPLETED" as const
};
const evaluation = {
  tenantId: "tenant",
  trialId: "trial",
  status: "FINAL" as const,
  decision: "READY_FOR_APPROVAL" as const,
  finalizedAt: new Date(0)
};

describe("canonical FINAL evidence predicate", () => {
  it("accepts exact final approval and revision evidence, never the opposite decision", () => {
    expect(isFinalTrialEvidence(trial, evaluation, "READY_FOR_APPROVAL", "version")).toBe(true);
    expect(isFinalTrialEvidence(trial, evaluation, "REVISION_REQUIRED")).toBe(false);
    expect(
      isFinalTrialEvidence(
        trial,
        { ...evaluation, decision: "REVISION_REQUIRED" },
        "REVISION_REQUIRED"
      )
    ).toBe(true);
  });
  it.each(["DRAFT", "PREPARED", "CANCELLED"] as const)("rejects %s Trial", (status) => {
    expect(isFinalTrialEvidence({ ...trial, status }, evaluation, "READY_FOR_APPROVAL")).toBe(
      false
    );
  });
  it("rejects wrong Formula, tenant, Trial, draft evaluation and missing finalization", () => {
    expect(isFinalTrialEvidence(trial, evaluation, "READY_FOR_APPROVAL", "another-version")).toBe(
      false
    );
    for (const patch of [
      { tenantId: "other" },
      { trialId: "other" },
      { status: "DRAFT" as const },
      { finalizedAt: null }
    ])
      expect(isFinalTrialEvidence(trial, { ...evaluation, ...patch }, "READY_FOR_APPROVAL")).toBe(
        false
      );
  });
});

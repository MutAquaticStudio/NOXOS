import { describe, expect, it } from "vitest";
import { resolveDevelopmentContext } from "../../apps/nox-os/src/development-context";

const formulaId = "11111111-1111-4111-8111-111111111111";
const trialId = "22222222-2222-4222-8222-222222222222";
const evaluationId = "33333333-3333-4333-8333-333333333333";
const input = {
  tenantId: "tenant-a",
  queryTenantId: "tenant-a",
  formulaVersionId: formulaId,
  formula: {
    formulaVersionId: formulaId,
    versionNumber: 2,
    bundleHash: "frozen-hash",
    status: "FROZEN",
    approvalState: "NOT_APPROVED",
    candidate: { projectId: trialId, sourceBriefId: evaluationId }
  },
  selectedTrialId: trialId,
  selectedEvaluationId: evaluationId,
  trial: {
    id: trialId,
    tenantId: "tenant-a",
    formulaVersionId: formulaId,
    formulaBundleHash: "frozen-hash",
    status: "COMPLETED"
  },
  evaluation: { id: evaluationId, trialId, status: "FINAL", decision: "READY_FOR_APPROVAL" },
  permissions: ["module.design-studio.studio.read", "module.trial-sensory.trial.read"]
};

describe("exact-lineage development projection", () => {
  it("keeps superseded versions historical and never presents Approval Review", () => {
    const result = resolveDevelopmentContext({
      ...input,
      formula: { ...input.formula, approvalState: "SUPERSEDED" }
    });
    expect(result.detail).toContain("historical context");
    expect(result.nodes.find((node) => node.label === "Readiness")).toMatchObject({
      state: "blocked"
    });
    expect(result.nodes.find((node) => node.label === "Readiness")?.href).toBeUndefined();
  });
  it("maps final evidence to G4 Approval Review, without granting mutation or G6 access", () => {
    const result = resolveDevelopmentContext(input);
    expect(result.currentLabel).toBe("Readiness");
    expect(result.detail).toBe("Approval Review");
    expect(result.nodes.find((node) => node.label === "Readiness")?.href).toBe(
      `/design-studio/formula-versions/${formulaId}?sourceTrialId=${trialId}&sourceEvaluationId=${evaluationId}`
    );
    expect(result.nodes.flatMap((node) => node.href ?? [])).not.toContain("/release-readiness/new");
    expect(result).not.toHaveProperty("allowedTransition");
  });
  it("retains readable immutable history without mutation permissions", () => {
    const result = resolveDevelopmentContext(input);
    expect(result.nodes.find((node) => node.label === "Trial")?.href).toBe(
      `/trials/${trialId}?view=preparation`
    );
    expect(
      resolveDevelopmentContext({ ...input, permissions: [] }).nodes.every((node) => !node.href)
    ).toBe(true);
  });
  it("never assumes latest Trial, Evaluation, readiness, production, or QC", () => {
    const result = resolveDevelopmentContext({
      ...input,
      selectedTrialId: null,
      selectedEvaluationId: null,
      trial: undefined,
      evaluation: undefined
    });
    expect(result.currentLabel).toBe("Design");
    expect(
      result.nodes
        .filter((node) => ["Trial", "Readiness", "Production", "QC/Release"].includes(node.label))
        .every((node) => node.state === "blocked" && !node.href)
    ).toBe(true);
  });
  it("fails closed for missing and conflicting lineage", () => {
    const invalid = [
      { ...input, queryTenantId: "other" },
      { ...input, formula: undefined },
      { ...input, formulaVersionId: trialId },
      {
        ...input,
        formula: { ...input.formula, candidate: { ...input.formula.candidate, projectId: "" } }
      },
      { ...input, trial: { ...input.trial, tenantId: "other" } },
      { ...input, trial: { ...input.trial, formulaBundleHash: "stale" } },
      { ...input, trial: { ...input.trial, formulaVersionId: trialId } },
      { ...input, selectedTrialId: null },
      { ...input, selectedEvaluationId: null },
      { ...input, evaluation: { ...input.evaluation, id: trialId } },
      { ...input, evaluation: { ...input.evaluation, trialId: formulaId } },
      { ...input, trial: { ...input.trial, status: "DRAFT" } },
      { ...input, evaluation: { ...input.evaluation, decision: null } }
    ];
    for (const candidate of invalid)
      expect(resolveDevelopmentContext(candidate)).toMatchObject({
        currentLabel: "Unknown phase",
        nodes: []
      });
  });
  it("projects revision to the exact immutable parent, not an approval transition", () => {
    const result = resolveDevelopmentContext({
      ...input,
      evaluation: { ...input.evaluation, decision: "REVISION_REQUIRED" }
    });
    expect(result.currentLabel).toBe("Design");
    expect(result.detail).toContain("Revision required");
    expect(result.nodes.find((node) => node.label === "Readiness")?.state).toBe("blocked");
    expect(result.nodes.find((node) => node.label === "Design")?.href).toContain(
      `sourceEvaluationId=${evaluationId}`
    );
  });
});

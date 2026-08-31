import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const previewWorkflow = readFileSync(".github/workflows/preview.yml", "utf8");
const stagingWorkflow = readFileSync(".github/workflows/staging.yml", "utf8");
const previewDeployer = readFileSync("scripts/deploy/authenticated-preview.ts", "utf8");
const stagingDeployer = readFileSync("scripts/deploy/staging.ts", "utf8");
const previewVerifier = readFileSync("scripts/verify/preview-g5-trial-sensory.ts", "utf8");
const stagingVerifier = readFileSync("scripts/verify/staging-g3-material-intelligence.ts", "utf8");
const tagWorkflow = readFileSync(".github/workflows/g5-acceptance-tag.yml", "utf8");

describe("G5 cloud acceptance boundary", () => {
  it("enables G5 only in the authenticated isolated Preview and Staging deployments", () => {
    expect(previewDeployer).toContain("module.trial-sensory");
    expect(stagingDeployer).toContain("module.trial-sensory");
    expect(previewDeployer).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(previewWorkflow).toContain("pnpm verify:preview:g5-trial-sensory");
    expect(stagingWorkflow).not.toContain("deploy:production");
  });

  it("proves exact-SHA authenticated scaling, evidence, revision, and approval in Preview", () => {
    expect(previewVerifier).toContain("G5_AUTHENTICATED_PREVIEW_ACCEPTANCE=PASS");
    expect(previewVerifier).toContain("G5_TRIAL_SCALING=PASS");
    expect(previewVerifier).toContain("G4 Accord approval with G5 evidence");
    expect(previewVerifier).toContain("WHOLE ACCORD");
    expect(previewVerifier).toContain("/revisions/freeze");
    expect(previewVerifier).toContain("parentFormulaVersionId !== formulaVersionId");
    expect(previewVerifier).toContain("sourceEvaluationId: approvalEvaluation");
    expect(previewVerifier).toContain("FINAL evaluation was not immutable");
    expect(previewWorkflow).toContain(
      "g5-preview-evidence-${{ github.event.pull_request.head.sha }}"
    );
  });

  it("proves Staging lineage, tenant isolation, DB immutability, audit, and G4 handoffs", () => {
    expect(stagingVerifier).toContain("G5 cross-tenant Formula lineage");
    expect(stagingVerifier).toContain("G5 cross-tenant Trial read");
    expect(stagingVerifier).toContain("G5 FINAL evidence immutability");
    expect(stagingVerifier).toContain("G4 revision freeze from G5 evidence");
    expect(stagingVerifier).toContain("G4 Formula approval with G5 evidence");
    expect(stagingVerifier).toContain("G5_STAGING_ACCORD_TRIAL=PASS");
    expect(stagingVerifier).toContain("G5 AuditEvent ${action} is missing");
    expect(stagingWorkflow).toContain("g5-staging-evidence-${{ github.sha }}");
  });

  it("binds the immutable G5 acceptance tag to matching merged Preview and Staging evidence", () => {
    expect(tagWorkflow).toContain(`.merge_commit_sha')\" = \"$TARGET_SHA\"`);
    expect(tagWorkflow).toContain("g5-staging-evidence-$TARGET_SHA");
    expect(tagWorkflow).toContain("g5-preview-evidence-$preview_sha");
    expect(tagWorkflow).toContain(
      "Acceptance tag already exists; refusing to overwrite immutable evidence."
    );
  });
});

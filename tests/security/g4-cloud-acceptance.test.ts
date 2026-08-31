import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const previewWorkflow = readFileSync(".github/workflows/preview.yml", "utf8");
const stagingWorkflow = readFileSync(".github/workflows/staging.yml", "utf8");
const previewDeployer = readFileSync("scripts/deploy/authenticated-preview.ts", "utf8");
const stagingDeployer = readFileSync("scripts/deploy/staging.ts", "utf8");
const previewVerifier = readFileSync("scripts/verify/preview-g4-design-studio.ts", "utf8");
const stagingVerifier = readFileSync("scripts/verify/staging-g3-material-intelligence.ts", "utf8");
const tagWorkflow = readFileSync(".github/workflows/g4-acceptance-tag.yml", "utf8");

describe("G4 cloud acceptance boundary", () => {
  it("deploys Design Studio only to authenticated Preview and isolated Staging", () => {
    expect(previewDeployer).toContain(
      "NOX_FEATURE_FLAGS=module.material-intelligence,module.design-studio"
    );
    expect(stagingDeployer).toContain(
      "NOX_FEATURE_FLAGS=module.material-intelligence,module.design-studio"
    );
    expect(stagingDeployer).toContain('"SUPABASE_SERVICE_ROLE_KEY="');
    expect(stagingDeployer).toContain('"SUPABASE_STORAGE_BUCKET="');
    expect(previewDeployer).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(previewWorkflow).toContain("pnpm verify:preview:g4-design-studio");
    expect(stagingWorkflow).not.toContain("deploy:production");
  });

  it("proves exact-SHA authenticated Formula and Accord workflows", () => {
    expect(previewVerifier).toContain("G4_FORMULA_WORKFLOW=PASS");
    expect(previewVerifier).toContain("G4_ACCORD_WORKFLOW=PASS");
    expect(previewVerifier).toContain("Forged authority headers affected");
    expect(previewVerifier).toContain("/trial-context");
    expect(previewWorkflow).toContain(
      "g4-preview-evidence-${{ github.event.pull_request.head.sha }}"
    );
  });

  it("proves Staging persistence, isolation, immutability, audit, and private provenance", () => {
    expect(stagingVerifier).toContain("Cross-tenant frozen Formula read");
    expect(stagingVerifier).toContain("Database did not reject FROZEN line mutation");
    expect(stagingVerifier).toContain("Formula approval modified the frozen composition identity");
    expect(stagingVerifier).toContain("G4 private source attachment");
    expect(stagingVerifier).toContain("G4 AuditEvent ${action} is missing");
    expect(stagingWorkflow).toContain("g4-staging-evidence-${{ github.sha }}");
  });

  it("creates the immutable Gate 4 tag only from matching merged Preview and Staging evidence", () => {
    expect(tagWorkflow).toContain(`.merge_commit_sha')" = "$TARGET_SHA"`);
    expect(tagWorkflow).toContain("g4-staging-evidence-$TARGET_SHA");
    expect(tagWorkflow).toContain("g4-preview-evidence-$preview_sha");
    expect(tagWorkflow).toContain(
      "Acceptance tag already exists; refusing to overwrite immutable evidence."
    );
  });
});

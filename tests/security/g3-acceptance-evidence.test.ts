import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stagingWorkflow = readFileSync(".github/workflows/staging.yml", "utf8");
const previewWorkflow = readFileSync(".github/workflows/preview.yml", "utf8");
const stagingVerifier = readFileSync("scripts/verify/staging-g3-material-intelligence.ts", "utf8");
const previewVerifier = readFileSync("scripts/verify/preview-g3-material-intelligence.ts", "utf8");
const authenticatedPreviewDeployer = readFileSync(
  "scripts/deploy/authenticated-preview.ts",
  "utf8"
);
const stagingEvidence = readFileSync("scripts/evidence/write-g3-staging-evidence.mjs", "utf8");
const tagWorkflow = readFileSync(".github/workflows/g3-acceptance-tag.yml", "utf8");

describe("G3 acceptance evidence boundary", () => {
  it("runs Material Staging acceptance only after the verified deployment and uploads SHA-bound evidence", () => {
    expect(stagingWorkflow).toContain("pnpm verify:staging:g3-material-intelligence");
    expect(stagingWorkflow).toContain("g3-staging-evidence-${{ github.sha }}");
    expect(stagingWorkflow.indexOf("id: deploy")).toBeLessThan(
      stagingWorkflow.indexOf("id: g3-material-intelligence")
    );
    expect(stagingWorkflow).not.toContain("deploy:production");
  });

  it("uses disposable non-production Auth fixtures and proves the four required authority paths", () => {
    expect(stagingVerifier).toContain('type FixtureKey = "A" | "B" | "C" | "D" | "E"');
    expect(stagingVerifier).toContain("Cross-tenant private Material access");
    expect(stagingVerifier).toContain("Tenant approver Platform correction");
    expect(stagingVerifier).toContain(
      "Platform Owner did not resolve the global Material correction."
    );
    expect(stagingVerifier).toContain("Dilution acceptance requires structured source");
    expect(stagingVerifier).toContain(
      "delete from material_intelligence.materials where id = ${materialId}"
    );
  });

  it("keeps authenticated Preview credentials browser-scoped and out of Material source", () => {
    expect(previewWorkflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository"
    );
    expect(previewWorkflow).toContain("NOX_PREVIEW_MATERIAL_USER_PASSWORD");
    expect(previewVerifier).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(previewVerifier).not.toContain("NOX_RUNTIME_DATABASE_URL");
    expect(previewVerifier).not.toContain("NOX_WORKFLOW_DATABASE_URL");
    expect(authenticatedPreviewDeployer).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(authenticatedPreviewDeployer).not.toContain("SUPABASE_ACCESS_TOKEN");
    expect(authenticatedPreviewDeployer).not.toContain("SUPABASE_DB_PASSWORD");
  });

  it("resolves the authenticated tenant before exercising tenant-scoped Material APIs", () => {
    expect(previewVerifier).toContain('fetch("/api/v1/me/tenants"');
    expect(previewVerifier).toContain('"x-nox-tenant-id": activeTenantId');
    expect(previewVerifier).toContain("await signIn(mobile)");
  });

  it("does not falsely freeze G3 in a mutable Staging artifact", () => {
    expect(stagingEvidence).toContain('EVIDENCE_SCHEMA: "G3-STAGING-1.0"');
    expect(stagingEvidence).not.toContain("GATE_3_STATUS");
    expect(stagingEvidence).not.toContain("G3B_STATUS");
    expect(stagingEvidence).not.toContain("G4_READY");
  });

  it("requires a merged PR, exact Staging artifact, and Preview artifact before creating the immutable tag", () => {
    expect(tagWorkflow).toContain(`.merge_commit_sha')" = "$TARGET_SHA"`);
    expect(tagWorkflow).toContain("g3-staging-evidence-$TARGET_SHA");
    expect(tagWorkflow).toContain("g3-preview-evidence-$preview_sha");
    expect(tagWorkflow).toContain(
      "Acceptance tag already exists; refusing to overwrite immutable evidence."
    );
  });
});

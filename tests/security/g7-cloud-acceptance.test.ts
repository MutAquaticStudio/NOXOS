import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("G7 cloud-only exact-SHA closure contract", () => {
  const preview = read(".github/workflows/preview.yml");
  const staging = read(".github/workflows/staging.yml");
  const tag = read(".github/workflows/g7-acceptance-tag.yml");
  const previewAcceptance = read("scripts/verify/preview-g5-trial-sensory.ts");
  const stagingAcceptance = read("scripts/verify/staging-g3-material-intelligence.ts");

  it("replays G7 migrations and binds authenticated Preview evidence to the exact PR SHA", () => {
    expect(preview).toContain("feature/g7-inventory-lot-traceability");
    expect(preview).toContain("G7_VISUAL_CAPTURE_DIR");
    expect(preview).toContain("write-g7-preview-evidence.mjs");
    expect(preview).toContain("g7-preview-evidence-${{ github.event.pull_request.head.sha }}");
    for (const marker of [
      "G7_PREVIEW_INVENTORY_ACCEPTANCE=PASS",
      "G7_PREVIEW_TRIAL_RESERVATION=PASS",
      "G7_PREVIEW_TRIAL_CONSUMPTION=PASS"
    ])
      expect(previewAcceptance).toContain(marker);
  });

  it("writes G7 Staging evidence only after ledger, Trial, concurrency, and security acceptance", () => {
    expect(staging).toContain("write-g7-staging-evidence.mjs");
    expect(staging).toContain("g7-staging-evidence-${{ github.sha }}");
    for (const marker of [
      "G7_STAGING_INVENTORY_ACCEPTANCE=PASS",
      "G7_STAGING_LEDGER_AND_RESERVATION=PASS",
      "G7_STAGING_TRIAL_ATOMICITY=PASS",
      "G7_STAGING_CONCURRENCY=PASS",
      "G7_STAGING_TENANT_RBAC=PASS"
    ])
      expect(stagingAcceptance).toContain(marker);
  });

  it("requires matching merged, Preview, and Staging SHA evidence before an immutable tag", () => {
    expect(tag).toContain(
      'test "$(printf \'%s\' "$pull_json" | jq -r \'.merge_commit_sha\')" = "$TARGET_SHA"'
    );
    expect(tag).toContain(
      'test "$(printf \'%s\' "$staging_run" | jq -r \'.head_sha\')" = "$TARGET_SHA"'
    );
    expect(tag).toContain("g7-preview-evidence-$preview_sha");
    expect(tag).toContain("g7-staging-evidence-$TARGET_SHA");
    expect(tag).toContain("g7-v1.0-accepted-${TARGET_SHA:0:8}");
  });

  it("does not add a Production workflow or mutation path", () => {
    expect(preview).not.toMatch(/NOX_MIGRATION_ENV:\s*production/);
    expect(staging).not.toMatch(/NOX_MIGRATION_ENV:\s*production/);
    expect(tag).not.toContain("deploy:production");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("G8 cloud-only exact-SHA closure contract", () => {
  const preview = read(".github/workflows/preview.yml");
  const staging = read(".github/workflows/staging.yml");
  const tag = read(".github/workflows/g8-acceptance-tag.yml");
  const previewAcceptance = read("scripts/verify/preview-g5-trial-sensory.ts");
  const stagingAcceptance = read("scripts/verify/staging-g3-material-intelligence.ts");

  it("binds authenticated Procurement Preview acceptance to the exact PR SHA", () => {
    expect(preview).toContain("G8_VISUAL_CAPTURE_DIR");
    expect(preview).toContain("write-g8-preview-evidence.mjs");
    expect(preview).toContain("g8-preview-evidence-${{ github.event.pull_request.head.sha }}");
    for (const marker of [
      "G8_PREVIEW_PROCUREMENT_ACCEPTANCE=PASS",
      "G8_PREVIEW_RECEIPT_ATOMICITY=PASS",
      "G8_PREVIEW_TRACEABILITY=PASS"
    ])
      expect(previewAcceptance).toContain(marker);
  });

  it("writes G8 Staging evidence after transaction, concurrency, and trace acceptance", () => {
    expect(staging).toContain("write-g8-staging-evidence.mjs");
    expect(staging).toContain("g8-staging-evidence-${{ github.sha }}");
    for (const marker of [
      "G8_STAGING_PROCUREMENT_ACCEPTANCE=PASS",
      "G8_STAGING_RECEIPT_ATOMICITY=PASS",
      "G8_STAGING_CONCURRENT_OVER_RECEIPT=PASS",
      "G8_STAGING_TRACEABILITY=PASS"
    ])
      expect(stagingAcceptance).toContain(marker);
    expect(stagingAcceptance).toContain("await Promise.all([");
    expect(stagingAcceptance).toContain("source_module = 'PROCUREMENT'");
    expect(stagingAcceptance).toContain('"GOODS_RECEIPT_ALREADY_POSTED"');
  });

  it("requires matching merged, Preview, and Staging evidence before an immutable tag", () => {
    expect(tag).toContain(
      'test "$(printf \'%s\' "$pull_json" | jq -r \'.merge_commit_sha\')" = "$TARGET_SHA"'
    );
    expect(tag).toContain("g8-preview-evidence-$preview_sha");
    expect(tag).toContain("g8-staging-evidence-$TARGET_SHA");
    expect(tag).toContain("GATE_8_STATUS=FROZEN");
    expect(tag).toContain("GATE_8_DOD=PASS");
    expect(tag).toContain("g8-v1.0-accepted-${TARGET_SHA:0:8}");
  });

  it("does not add a Production migration or deployment path", () => {
    expect(preview).not.toMatch(/NOX_MIGRATION_ENV:\s*production/);
    expect(staging).not.toMatch(/NOX_MIGRATION_ENV:\s*production/);
    expect(tag).not.toContain("deploy:production");
  });
});

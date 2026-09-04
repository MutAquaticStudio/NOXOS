import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("G10 cloud-only exact-SHA closure contract", () => {
  const preview = read(".github/workflows/preview.yml");
  const staging = read(".github/workflows/staging.yml");
  const tag = read(".github/workflows/g10-acceptance-tag.yml");
  const previewAcceptance = read("scripts/verify/preview-g5-trial-sensory.ts");
  const stagingAcceptance = read("scripts/verify/staging-g3-material-intelligence.ts");

  it("binds authenticated G10 Preview acceptance to the exact PR SHA", () => {
    expect(preview).toContain("write-g10-preview-evidence.mjs");
    expect(preview).toContain("g10-preview-evidence-${{ github.event.pull_request.head.sha }}");
    for (const marker of [
      "G10_PREVIEW_QC_BATCH_RELEASE_ACCEPTANCE=PASS",
      "G10_PREVIEW_EXACT_DECIMAL_AND_JUDGEMENT=PASS",
      "G10_PREVIEW_CURRENT_G6_REVALIDATION=PASS",
      "G10_PREVIEW_TERMINAL_DECISION_SERIALIZATION=PASS",
      "G10_PREVIEW_NO_G7_G9_MUTATION=PASS"
    ])
      expect(previewAcceptance).toContain(marker);
  });

  it("writes G10 Staging evidence only after the authoritative acceptance", () => {
    expect(staging).toContain("write-g10-staging-evidence.mjs");
    expect(staging).toContain("g10-staging-evidence-${{ github.sha }}");
    for (const marker of [
      "G10_STAGING_QC_BATCH_RELEASE_ACCEPTANCE=PASS",
      "G10_STAGING_CURRENT_G6_REVALIDATION=PASS",
      "G10_STAGING_TERMINAL_DECISION_SERIALIZATION=PASS",
      "G10_STAGING_NO_G7_G9_MUTATION=PASS"
    ])
      expect(stagingAcceptance).toContain(marker);
  });

  it("requires matching merged, Preview, and Staging evidence before an immutable annotated tag", () => {
    expect(tag).toContain("jq -r '.merge_commit_sha'");
    expect(tag).toContain('= "$TARGET_SHA"');
    expect(tag).toContain("g10-preview-evidence-$preview_sha");
    expect(tag).toContain("g10-staging-evidence-$TARGET_SHA");
    expect(tag).toContain("g10-v1.0-accepted-${TARGET_SHA:0:8}");
    expect(tag).toContain('git tag -a "$TAG_NAME" "$TARGET_SHA"');
    expect(tag).toContain('test "$(git cat-file -t "refs/tags/$TAG_NAME")" = "tag"');
  });

  it("does not add a Production migration or deployment path", () => {
    expect(preview).not.toMatch(/NOX_MIGRATION_ENV:\s*production/);
    expect(staging).not.toMatch(/NOX_MIGRATION_ENV:\s*production/);
    expect(tag).not.toContain("deploy:production");
  });
});

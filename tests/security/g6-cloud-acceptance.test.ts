import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("G6 cloud-only exact-SHA closure contract", () => {
  const preview = read(".github/workflows/preview.yml");
  const staging = read(".github/workflows/staging.yml");
  const tag = read(".github/workflows/g6-acceptance-tag.yml");
  const previewAcceptance = read("scripts/verify/preview-g5-trial-sensory.ts");
  const stagingAcceptance = read("scripts/verify/staging-g3-material-intelligence.ts");

  it("binds authenticated Preview G6 paths and evidence to the exact PR SHA", () => {
    expect(preview).toContain("G6_VISUAL_CAPTURE_DIR");
    expect(preview).toContain("NOX_PREVIEW_RUNTIME_DATABASE_URL");
    expect(preview).toContain("write-g6-preview-evidence.mjs");
    expect(preview).toContain("g6-preview-evidence-${{ github.event.pull_request.head.sha }}");
    for (const marker of [
      "G6_PREVIEW_READY_PATH=PASS",
      "G6_PREVIEW_REVIEW_REQUIRED_PATH=PASS",
      "G6_PREVIEW_BLOCKED_PATH=PASS",
      "G6_PREVIEW_ACCORD_REJECTION=PASS",
      "G6_PREVIEW_TENANT_DENIAL=PASS",
      "G6_PREVIEW_IMMUTABLE_HISTORY=PASS"
    ])
      expect(previewAcceptance).toContain(marker);
  });

  it("writes G6 Staging evidence only after real three-path and tenant acceptance", () => {
    expect(staging.indexOf("G6_STAGING_READY_PATH=PASS")).toBe(-1);
    expect(staging).toContain("write-g6-staging-evidence.mjs");
    expect(staging).toContain("g6-staging-evidence-${{ github.sha }}");
    for (const marker of [
      "G6_STAGING_READY_PATH=PASS",
      "G6_STAGING_REVIEW_REQUIRED_PATH=PASS",
      "G6_STAGING_BLOCKED_PATH=PASS",
      "G6_STAGING_IMMUTABILITY=PASS",
      "G6_STAGING_TENANT_SECURITY=PASS"
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
    expect(tag).toContain("g6-preview-evidence-$preview_sha");
    expect(tag).toContain("g6-staging-evidence-$TARGET_SHA");
    expect(tag).toContain("g6-v1.0-accepted-${TARGET_SHA:0:8}");
  });

  it("does not add any Production workflow or mutation path", () => {
    expect(preview).not.toMatch(/NOX_MIGRATION_ENV:\s*production/);
    expect(staging).not.toMatch(/NOX_MIGRATION_ENV:\s*production/);
    expect(tag).not.toContain("deploy:production");
  });
});

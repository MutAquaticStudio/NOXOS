import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const acceptance = read(".github/workflows/g13-acceptance-tag.yml");
const preview = read(".github/workflows/preview.yml");
const staging = read(".github/workflows/staging.yml");

describe("G13 exact-SHA evidence workflow", () => {
  it("requires matching immutable Preview and Staging evidence before an annotated tag", () => {
    expect(acceptance).toContain(
      'test "$(printf \'%s\' "$pull_json" | jq -r \'.merge_commit_sha\')" = "$TARGET_SHA"'
    );
    expect(acceptance).toContain(
      'test "$(printf \'%s\' "$staging_run" | jq -r \'.head_sha\')" = "$TARGET_SHA"'
    );
    expect(acceptance).toContain("STAGING_EXACT_SHA=PASS");
    expect(acceptance).toContain("PREVIEW_EXACT_SHA=PASS");
    expect(acceptance).toContain('git tag -a "$TAG_NAME" "$TARGET_SHA"');
    expect(acceptance).toContain('git cat-file -t "refs/tags/$TAG_NAME")" = tag');
  });

  it("generates G13 Preview and Staging evidence only after their acceptance steps", () => {
    expect(preview).toContain("pnpm verify:preview:g13-commercial-orders");
    expect(preview).toContain("write-g13-preview-evidence.mjs");
    expect(preview).toContain("g13-preview-evidence-${{ github.event.pull_request.head.sha }}");
    expect(staging).toContain("pnpm verify:staging:g3-material-intelligence");
    expect(staging).toContain("write-g13-staging-evidence.mjs");
    expect(staging).toContain("g13-staging-evidence-${{ github.sha }}");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("G2 acceptance-tag workflow", () => {
  it("creates only an annotated tag for SHA-bound successful Staging evidence", () => {
    const workflow = readFileSync(".github/workflows/g2-acceptance-tag.yml", "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain(
      'test "$(printf \'%s\' \"$run_json\" | jq -r \'.conclusion\')" = "success"'
    );
    expect(workflow).toContain(
      'test "$(printf \'%s\' \"$run_json\" | jq -r \'.head_branch\')" = "main"'
    );
    expect(workflow).toContain('expected_artifact="g2-staging-evidence-$TARGET_SHA"');
    expect(workflow).toContain('git merge-base --is-ancestor "$TARGET_SHA" "origin/main"');
    expect(workflow).toContain('git tag -a "$TAG_NAME" "$TARGET_SHA"');
    expect(workflow).toContain('git push origin "refs/tags/$TAG_NAME"');
    expect(workflow).toContain("refusing to overwrite immutable evidence");
    expect(workflow).not.toContain("SUPABASE_");
    expect(workflow).not.toContain("VERCEL_");
    expect(workflow).not.toContain("production");
  });
});

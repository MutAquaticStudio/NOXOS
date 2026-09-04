import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(resolve(root, ".github/workflows/g12-acceptance-tag.yml"), "utf8");

describe("G12 acceptance evidence binding", () => {
  it("requires merged PR, exact Preview/Staging SHA evidence, and an annotated tag", () => {
    for (const requirement of [
      "pr_number",
      "staging_evidence_run_id",
      "preview_evidence_run_id",
      ".merge_commit_sha",
      ".head_sha",
      "g12-staging-evidence-$TARGET_SHA",
      "g12-preview-evidence-$preview_sha",
      "STAGING_EXACT_SHA=PASS",
      "PREVIEW_EXACT_SHA=PASS",
      "G12_SCHEMA=PASS",
      "PROJECT_OPERATIONS_SOURCE=PASS",
      "UPSTREAM_MUTATION_FROM_G12=NONE",
      "git tag -a",
      "g12-v1.0-accepted-${TARGET_SHA:0:8}"
    ])
      expect(workflow).toContain(requirement);
    expect(workflow).not.toContain("actions/checkout@v6");
  });
});

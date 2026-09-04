import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Gate 11 immutable acceptance workflow", () => {
  it("binds annotated acceptance to exact Preview and Staging evidence", async () => {
    const workflow = await readFile(".github/workflows/g11-acceptance-tag.yml", "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("g11-staging-evidence-$TARGET_SHA");
    expect(workflow).toContain("g11-preview-evidence-$preview_sha");
    expect(workflow).toContain('test \"$(git cat-file -t \"refs/tags/$TAG_NAME\")\" = \"tag\"');
    expect(workflow).toContain(
      'test \"$(git rev-parse \"refs/tags/$TAG_NAME^{}\")\" = \"$TARGET_SHA\"'
    );
    expect(workflow).toContain("g11-v1.0-accepted-${TARGET_SHA:0:8}");
    expect(workflow).toContain("PRODUCTION_PROMOTION_PERFORMED=NO");
    expect(workflow).not.toMatch(/deploy:production|db:migrate:production/);
  });

  it("requires same-run G3 through G10 regression artifacts", async () => {
    const workflow = await readFile(".github/workflows/g11-acceptance-tag.yml", "utf8");
    expect(workflow).toContain("for gate in g3 g4 g5 g6 g7 g8 g9 g10 g11");
    expect(workflow).toContain("G3_G10_REGRESSION=PASS");
  });
});

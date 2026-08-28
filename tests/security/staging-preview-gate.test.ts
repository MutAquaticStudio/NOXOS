import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Staging accepted Preview gate", () => {
  it("resolves trusted Preview evidence before any provider side effect", () => {
    const workflow = readFileSync(".github/workflows/staging.yml", "utf8");
    const acceptedPreview = workflow.indexOf("id: accepted-preview");

    expect(acceptedPreview).toBeGreaterThan(-1);
    for (const sideEffect of ["pnpm infra:apply", "pnpm db:migrate:cloud", "pnpm deploy:staging"]) {
      expect(acceptedPreview).toBeLessThan(workflow.indexOf(sideEffect));
    }
    expect(workflow).toMatch(/^\s*actions: read$/m);
    expect(workflow).toContain("ACCEPTED_PREVIEW_ARTIFACT");
    expect(workflow).toContain("ACCEPTED_PREVIEW_RUN");
    expect(workflow).toContain("steps.verify-evidence-tag.outcome");
    expect(workflow).not.toContain("G1_DOD_A_FROZEN_INPUTS: PASS");
  });
});

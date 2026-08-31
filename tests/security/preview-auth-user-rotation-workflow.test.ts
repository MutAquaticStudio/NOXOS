import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
  new URL("../../.github/workflows/preview-auth-user-rotation.yml", import.meta.url)
);

describe("Preview Auth user rotation workflow", () => {
  it("is manual, Preview-only, branch-bound, and constrained to the fixture user", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toContain("push:");
    expect(workflow).toContain("environment: Preview");
    expect(workflow).toContain("github.ref == 'refs/heads/chore/preview-auth-rotation'");
    expect(workflow).toContain("SUPABASE_PREVIEW_ACCESS_TOKEN");
    expect(workflow).toContain("/api-keys?reveal=true");
    expect(workflow).toContain("NOX_PREVIEW_MATERIAL_USER_ID");
    expect(workflow).toContain("NOX_PREVIEW_MATERIAL_USER_EMAIL");
    expect(workflow).toContain("NOX_PREVIEW_MATERIAL_USER_PASSWORD");
    expect(workflow).toContain("uurkjmkhvtqydeikncaw");
    expect(workflow).toContain("7d9fe589-a316-41ca-8bd3-1f6c58bdcef1");
    expect(workflow).not.toContain("environment: Staging");
    expect(workflow).not.toContain("environment: Production");
    expect(workflow).not.toContain("SUPABASE_PRODUCTION_");
    expect(workflow).not.toContain("NOX_STAGING_");
  });

  it("does not log or accept secrets as workflow inputs", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).not.toMatch(/^\s+inputs:/m);
    expect(workflow).not.toContain("console.log(targetEmail)");
    expect(workflow).not.toContain("console.log(targetPassword)");
    expect(workflow).not.toContain("console.log(serviceRoleKey)");
  });
});

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

function readBuildOutput(directory: string): string {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

function buildWithEnvironment(environment: Record<string, string>) {
  const outputDirectory = mkdtempSync(join(tmpdir(), "nox-vite-environment-"));
  const result = spawnSync(
    "pnpm",
    ["--filter", "@nox-os/web", "exec", "vite", "build", "--manifest", "--outDir", outputDirectory],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        // Vitest sets NODE_ENV=test. Measure the production-mode Vite artifact,
        // not development React code inherited from the test runner's process.
        NODE_ENV: "production",
        CI: "true",
        ...environment
      }
    }
  );
  const output = result.status === 0 ? readBuildOutput(outputDirectory) : "";
  let eagerJavaScriptBytes = 0;
  if (result.status === 0) {
    const manifest = JSON.parse(
      readFileSync(join(outputDirectory, ".vite/manifest.json"), "utf8")
    ) as Record<string, { file: string; imports?: string[] }>;
    const visited = new Set<string>();
    const visit = (key: string) => {
      if (visited.has(key)) return;
      visited.add(key);
      const chunk = manifest[key]!;
      eagerJavaScriptBytes += statSync(join(outputDirectory, chunk.file)).size;
      for (const dependency of chunk.imports ?? []) visit(dependency);
    };
    visit("index.html");
  }
  rmSync(outputDirectory, { force: true, recursive: true });

  return { output, result, eagerJavaScriptBytes };
}

describe("Vite public-environment boundary", () => {
  beforeAll(() => {
    const result = spawnSync("pnpm", ["--workspace-root", "build:packages"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, CI: "true" }
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
  });

  it("allows only approved application public configuration", () => {
    const { result, eagerJavaScriptBytes } = buildWithEnvironment({
      VITE_NOX_ENV: "preview",
      VITE_NOX_SOURCE_SHA: "approved-application-sha"
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    // Sum the actual static entry graph, not just one file or an arbitrary split.
    // Auth and authenticated workspace chunks are deliberately dynamic, not removed.
    expect(eagerJavaScriptBytes).toBeGreaterThan(0);
    expect(eagerJavaScriptBytes).toBeLessThanOrEqual(350_000);
  });

  it("allows the exact Supabase browser endpoint and publishable key without a broad public prefix", () => {
    const { output, result } = buildWithEnvironment({
      VITE_NOX_ENV: "preview",
      VITE_NOX_SOURCE_SHA: "approved-application-sha",
      VITE_SUPABASE_URL: "https://preview-project.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_preview_test"
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(output).toContain("https://preview-project.supabase.co");
    expect(output).toContain("sb_publishable_preview_test");
  });

  it("does not fail on or expose Vercel public system metadata", () => {
    const { output, result } = buildWithEnvironment({
      VITE_NOX_ENV: "preview",
      VITE_NOX_SOURCE_SHA: "approved-application-sha",
      VITE_VERCEL_ENV: "provider-preview-marker",
      VITE_VERCEL_GIT_COMMIT_SHA: "provider-sha-marker"
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(output).not.toContain("provider-preview-marker");
    expect(output).not.toContain("provider-sha-marker");
  });

  it("bundles NØX-owned source identity into the client contract", () => {
    const sourceSha = "a".repeat(40);
    const { output, result } = buildWithEnvironment({
      VITE_NOX_ENV: "preview",
      VITE_NOX_SOURCE_SHA: sourceSha
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(output).toContain(sourceSha);
  });

  it.each([
    "VITE_DATABASE_URL",
    "VITE_SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_ACCESS_TOKEN",
    "VITE_UNAPPROVED_SECRET"
  ])("rejects %s before bundling", (key) => {
    const { result } = buildWithEnvironment({ [key]: "unsafe-test-value" });

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(new RegExp(key));
  });
});

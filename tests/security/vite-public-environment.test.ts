import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
    ["--filter", "@nox-os/web", "exec", "vite", "build", "--outDir", outputDirectory],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        ...environment
      }
    }
  );
  const output = result.status === 0 ? readBuildOutput(outputDirectory) : "";
  rmSync(outputDirectory, { force: true, recursive: true });

  return { output, result };
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
    const { result } = buildWithEnvironment({
      VITE_NOX_ENV: "preview",
      VITE_NOX_SOURCE_SHA: "approved-application-sha",
      VITE_TURNSTILE_SITE_KEY: "approved-public-site-key"
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
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

  it.each(["VITE_DATABASE_URL", "VITE_SUPABASE_SERVICE_ROLE_KEY", "VITE_CF_API_TOKEN"])(
    "rejects %s before bundling",
    (key) => {
      const { result } = buildWithEnvironment({ [key]: "unsafe-test-value" });

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(new RegExp(key));
    }
  );
});

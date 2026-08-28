import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";

const appConfigPath = "apps/nox-os/vercel.json";
const appConfig = JSON.parse(readFileSync(appConfigPath, "utf8")) as {
  git?: { deploymentEnabled?: Record<string, boolean> };
  outputDirectory?: string;
  regions?: string[];
  functions?: Record<string, unknown>;
};

describe("Vercel project layout", () => {
  it("keeps the Vercel project configuration and API within the configured app root", () => {
    expect(existsSync(appConfigPath)).toBe(true);
    expect(existsSync("apps/nox-os/api/v1/[...route].ts")).toBe(true);
    expect(existsSync("vercel.json")).toBe(false);
    expect(appConfig.outputDirectory).toBe("dist");
    expect(appConfig.regions).toEqual(["syd1"]);
    expect(appConfig.git?.deploymentEnabled?.main).toBe(false);
    expect(appConfig.functions?.["api/v1/[...route].ts"]).toBeDefined();
    expect(appConfig.functions?.["api/queues/workflow-foundation.ts"]).toBeDefined();

    const reconciliation = readFileSync("scripts/infra/reconcile-vercel-staging.ts", "utf8");
    expect(reconciliation).toContain('rootDirectory: "apps/nox-os"');
    expect(reconciliation).toContain("VERCEL_PROJECT_ROOT_READBACK=PASS");
  });

  it("keeps workspace exports resolvable after Vercel transpiles TypeScript to JavaScript", () => {
    for (const packageJsonPath of fg.sync("packages/*/package.json")) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        name: string;
        exports?: Record<
          string,
          string | { types?: string; development?: string; default?: string }
        >;
      };
      const rootExport = packageJson.exports?.["."];

      expect(rootExport, packageJson.name).toEqual({
        types: packageJson.name === "@nox-os/ui" ? "./src/index.tsx" : "./src/index.ts",
        development: packageJson.name === "@nox-os/ui" ? "./src/index.tsx" : "./src/index.ts",
        default: "./dist/index.js"
      });
      expect(
        existsSync(packageJsonPath.replace("package.json", "src/index.ts")) ||
          existsSync(packageJsonPath.replace("package.json", "src/index.tsx")),
        packageJson.name
      ).toBe(true);
    }
  });

  it("creates a verified repository-root link before using Vercel's configured project root", () => {
    for (const deployer of ["scripts/deploy/staging.ts", "scripts/deploy/production.ts"]) {
      const source = readFileSync(deployer, "utf8");
      expect(source).not.toContain('"--cwd"');
      expect(source).toContain('"--project"');
      expect(source).toContain('"--token"');
      expect(source).not.toContain('"--scope"');
      expect(source).toContain("function prepareVercelProjectLink");
      expect(source).toContain('join(linkDirectory, "project.json")');
      expect(source).toContain("Existing Vercel project link does not match");
    }

    const stagingDeployer = readFileSync("scripts/deploy/staging.ts", "utf8");
    expect(stagingDeployer).toContain("prepareVercelProjectLink();");
    expect(stagingDeployer).toContain('runVercel(["build", "--yes", "--target=" + target])');
    expect(stagingDeployer).not.toContain('runVercel(["pull"');
  });
});

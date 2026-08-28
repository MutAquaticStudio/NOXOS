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

  it("deploys Staging source through the reconciled Vercel project without a local prebuilt artifact", () => {
    const stagingDeployer = readFileSync("scripts/deploy/staging.ts", "utf8");
    expect(stagingDeployer).not.toContain('"--cwd"');
    expect(stagingDeployer).toContain('"--project"');
    expect(stagingDeployer).toContain('"--token"');
    expect(stagingDeployer).not.toContain('"--scope"');
    expect(stagingDeployer).not.toContain('"--prebuilt"');
    expect(stagingDeployer).not.toContain("function prepareVercelProjectLink");
    expect(stagingDeployer).toContain('"--build-env"');
    expect(stagingDeployer).toContain('"VITE_TURNSTILE_SITE_KEY="');
    expect(stagingDeployer).not.toContain('"--build-env",\n  "NOX_RUNTIME_DATABASE_URL=');

    const productionDeployer = readFileSync("scripts/deploy/production.ts", "utf8");
    expect(productionDeployer).toContain("function prepareVercelProjectLink");
    expect(productionDeployer).toContain('"--prebuilt"');
  });

  it("proves each Staging deployment belongs to the reconciled custom environment", () => {
    const workflow = readFileSync(".github/workflows/staging.yml", "utf8");
    const stagingDeployer = readFileSync("scripts/deploy/staging.ts", "utf8");
    const dataPlaneVerifier = readFileSync("scripts/verify/staging-data-plane.ts", "utf8");

    expect(workflow).toContain("pnpm infra:vercel-staging:reconcile");
    expect(stagingDeployer).toContain('"--environment",\n  target');
    expect(stagingDeployer).toContain("function listVercelProjectDeployments");
    expect(stagingDeployer).toContain("assertVercelCustomEnvironmentMembership");
    expect(dataPlaneVerifier).toContain('target: "staging"');
  });
});

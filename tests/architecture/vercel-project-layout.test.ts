import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appConfigPath = "apps/nox-os/vercel.json";
const appConfig = JSON.parse(readFileSync(appConfigPath, "utf8")) as {
  outputDirectory?: string;
  functions?: Record<string, unknown>;
};

describe("Vercel project layout", () => {
  it("keeps the Vercel project configuration and API within the configured app root", () => {
    expect(existsSync(appConfigPath)).toBe(true);
    expect(existsSync("apps/nox-os/api/v1/[...route].ts")).toBe(true);
    expect(existsSync("vercel.json")).toBe(false);
    expect(appConfig.outputDirectory).toBe("dist");
    expect(appConfig.functions?.["api/v1/[...route].ts"]).toBeDefined();
  });
});

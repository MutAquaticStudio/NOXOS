import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync("apps/nox-os/vite.config.ts", "utf8");
const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  functions?: Record<string, { maxDuration?: number; supportsCancellation?: boolean }>;
};

describe("performance foundation", () => {
  it("keeps bundle warnings and the Vercel function limit aligned with the documented policy", () => {
    expect(viteConfig).toContain("chunkSizeWarningLimit: 350");
    expect(vercelConfig.functions?.["api/v1/[...route].ts"]).toEqual({
      maxDuration: 10,
      supportsCancellation: true
    });
  });
});
